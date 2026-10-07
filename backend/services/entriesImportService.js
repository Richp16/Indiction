const crypto = require('crypto');
const { query, pool } = require('../db');
const { parseEntriesWorkbook, normalizeName } = require('./entriesImportParser');
const { createDailyEntryInTransaction } = require('./dailyEntryService');
const { resolvePayPeriodForDate } = require('./payPeriodResolver');

const previewCache = new Map();
const PREVIEW_TTL_MS = 30 * 60 * 1000;

function storePreview(data) {
  const importId = crypto.randomUUID();
  previewCache.set(importId, { ...data, createdAt: Date.now() });
  return importId;
}

function getPreview(importId) {
  const entry = previewCache.get(importId);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > PREVIEW_TTL_MS) {
    previewCache.delete(importId);
    return null;
  }
  return entry;
}

async function loadReferenceData() {
  const [workersResult, sitesResult] = await Promise.all([
    query(
      `SELECT id, employee_code, first_name, last_name, is_active
       FROM workers`
    ),
    query(`SELECT id, job_code, name FROM job_sites WHERE is_active = true`),
  ]);

  const workersByCode = new Map();
  const workersByName = new Map();
  const nameCounts = new Map();
  for (const worker of workersResult.rows) {
    if (worker.employee_code) {
      workersByCode.set(String(worker.employee_code).trim().toLowerCase(), worker);
    }
    const keys = [
      normalizeName(`${worker.last_name}, ${worker.first_name}`),
      normalizeName(`${worker.first_name} ${worker.last_name}`),
    ];
    for (const nameKey of keys) {
      nameCounts.set(nameKey, (nameCounts.get(nameKey) || 0) + 1);
      if (!workersByName.has(nameKey)) {
        workersByName.set(nameKey, worker);
      }
    }
  }

  const sitesByCode = new Map();
  const sitesByName = new Map();
  for (const site of sitesResult.rows) {
    sitesByCode.set(String(site.job_code).trim().toLowerCase(), site);
    sitesByName.set(normalizeName(site.name), site);
  }

  return { workersByCode, workersByName, nameCounts, sitesByCode, sitesByName };
}

function resolveWorker(row, refs) {
  if (row.employeeCode) {
    const match = refs.workersByCode.get(row.employeeCode.toLowerCase());
    if (match) {
      return { status: 'matched', worker: match, matchType: 'employee_code' };
    }
  }

  const nameKeys = [];
  if (row.workerName) {
    nameKeys.push(normalizeName(row.workerName));
  }
  if (row.firstName || row.lastName) {
    nameKeys.push(normalizeName(`${row.lastName}, ${row.firstName}`));
    nameKeys.push(normalizeName(`${row.firstName} ${row.lastName}`));
  }

  for (const key of nameKeys) {
    if ((refs.nameCounts.get(key) || 0) > 1) {
      return {
        status: 'ambiguous',
        message: `Ambiguous worker name "${row.workerName || key}" — use employee_code`,
      };
    }
    const match = refs.workersByName.get(key);
    if (match) {
      return { status: 'matched', worker: match, matchType: 'name' };
    }
  }

  return {
    status: 'unmatched',
    suggestedCreate: {
      employeeCode: row.employeeCode,
      firstName: row.firstName || row.workerName || 'Unknown',
      lastName: row.lastName || '',
    },
  };
}

function resolveJobSite(row, refs) {
  const raw = row.jobSiteRaw;
  const codeMatch = refs.sitesByCode.get(raw.toLowerCase());
  if (codeMatch) {
    return { status: 'matched', jobSite: codeMatch, matchType: 'job_code' };
  }

  const nameMatch = refs.sitesByName.get(normalizeName(raw));
  if (nameMatch) {
    return { status: 'matched', jobSite: nameMatch, matchType: 'name' };
  }

  return { status: 'unmatched', jobSiteRaw: raw };
}

async function previewImport(buffer, { filename = 'import.xlsx' } = {}) {
  const parsed = parseEntriesWorkbook(buffer);
  const refs = await loadReferenceData();

  const matched = [];
  const unmatchedWorkers = [];
  const unmatchedSites = [];
  const rowErrors = [...parsed.errors];
  const seenKeys = new Map();

  for (const row of parsed.rows) {
    if (row.errors.length) continue;

    const workerResult = resolveWorker(row, refs);
    const siteResult = resolveJobSite(row, refs);

    if (workerResult.status === 'ambiguous') {
      rowErrors.push({
        rowNumber: row.rowNumber,
        reasons: [workerResult.message],
      });
      continue;
    }

    if (workerResult.status === 'unmatched') {
      unmatchedWorkers.push({
        rowNumber: row.rowNumber,
        ...workerResult.suggestedCreate,
      });
    }
    if (siteResult.status === 'unmatched') {
      unmatchedSites.push({ rowNumber: row.rowNumber, jobSiteRaw: siteResult.jobSiteRaw });
    }

    const dupKey = [
      row.dateWorked,
      row.employeeCode || row.workerName || '',
      row.jobSiteRaw,
      row.payCode,
    ]
      .join('|')
      .toLowerCase();
    if (seenKeys.has(dupKey)) {
      rowErrors.push({
        rowNumber: row.rowNumber,
        reasons: [
          `Duplicate of row ${seenKeys.get(dupKey)} in file (same date/worker/site/pay_code)`,
        ],
      });
      continue;
    }
    seenKeys.set(dupKey, row.rowNumber);

    let payPeriod = null;
    try {
      payPeriod = await resolvePayPeriodForDate(row.dateWorked);
    } catch (error) {
      rowErrors.push({
        rowNumber: row.rowNumber,
        reasons: [error.message || 'No pay period for date'],
      });
      continue;
    }

    matched.push({
      rowNumber: row.rowNumber,
      dateWorked: row.dateWorked,
      payCode: row.payCode,
      hours: row.hours,
      reimbursementAmount: row.reimbursementAmount || 0,
      workerId: workerResult.worker?.id || null,
      workerName: workerResult.worker
        ? `${workerResult.worker.last_name}, ${workerResult.worker.first_name}`
        : row.workerName,
      workerMatch: workerResult.status,
      jobSiteId: siteResult.jobSite?.id || null,
      jobSiteLabel: siteResult.jobSite
        ? `${siteResult.jobSite.name} (${siteResult.jobSite.job_code})`
        : row.jobSiteRaw,
      siteMatch: siteResult.status,
      payPeriodId: payPeriod.id,
    });
  }

  const importId = storePreview({
    filename,
    parsed,
    matched,
    unmatchedWorkers,
    unmatchedSites,
    rowErrors,
  });

  return {
    importId,
    filename,
    rowCount: parsed.rowCount,
    matchedCount: matched.filter((r) => r.workerId && r.jobSiteId).length,
    errorCount: rowErrors.length,
    unmatchedWorkerCount: unmatchedWorkers.length,
    unmatchedSiteCount: unmatchedSites.length,
    matched,
    unmatchedWorkers,
    unmatchedSites,
    errors: rowErrors,
    duplicatePolicy: {
      merge: 'Upsert via daily entry save (may add hours depending on pay code)',
      replace: 'Delete existing same worker/site/date/pay_code then insert',
      skip: 'Use replace=false and omit createWorkers for unmatched rows',
    },
  };
}

async function commitImport({
  importId,
  mode = 'merge',
  createWorkers = [],
  enteredBy,
}) {
  const preview = getPreview(importId);
  if (!preview) {
    const error = new Error('Import preview expired or not found');
    error.statusCode = 404;
    throw error;
  }

  const createMap = new Map(createWorkers.map((w) => [w.rowNumber, w]));
  const client = await pool.connect();

  let created = 0;
  let skipped = 0;
  const affectedPairs = new Set();

  try {
    await client.query('BEGIN');

    for (const row of preview.parsed.rows) {
      if (row.errors.length) {
        skipped += 1;
        continue;
      }

      let workerId = null;
      const matched = preview.matched.find((m) => m.rowNumber === row.rowNumber);
      if (matched?.workerId) {
        workerId = matched.workerId;
      } else {
        const createPayload = createMap.get(row.rowNumber);
        if (!createPayload) {
          skipped += 1;
          continue;
        }
        const inserted = await client.query(
          `INSERT INTO workers (
             paychex_worker_id, employee_code, first_name, last_name, is_active
           ) VALUES (NULL, $1, $2, $3, true)
           RETURNING id`,
          [
            createPayload.employeeCode || row.employeeCode || null,
            createPayload.firstName || row.firstName || 'Unknown',
            createPayload.lastName || row.lastName || '',
          ]
        );
        workerId = inserted.rows[0].id;
      }

      const jobSiteId = matched?.jobSiteId;
      if (!jobSiteId) {
        skipped += 1;
        continue;
      }

      const payPeriod = await resolvePayPeriodForDate(row.dateWorked);

      if (mode === 'replace') {
        await client.query(
          `DELETE FROM daily_time_entries
           WHERE worker_id = $1
             AND job_site_id = $2
             AND date_worked = $3::date
             AND pay_code = $4`,
          [workerId, jobSiteId, row.dateWorked, row.payCode]
        );
      }

      await createDailyEntryInTransaction(client, {
        workerId,
        jobSiteId,
        payCode: row.payCode,
        dateWorked: row.dateWorked,
        hours: row.hours,
        reimbursementAmount: row.reimbursementAmount || 0,
        payPeriodId: payPeriod.id,
        enteredBy,
      });

      affectedPairs.add(`${payPeriod.id}:${workerId}`);
      created += 1;
    }

    await client.query('COMMIT');
    previewCache.delete(importId);

    return {
      ok: true,
      created,
      skipped,
      affectedPayPeriodWorkers: affectedPairs.size,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  previewImport,
  commitImport,
  buildImportTemplateWorkbook: require('./entriesImportParser').buildImportTemplateWorkbook,
};
