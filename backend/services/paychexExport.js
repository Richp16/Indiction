const { query } = require('../db');

/**
 * Paychex Flex SPI import columns (Paychex_Import.csv).
 * One row per (worker, pay component[, effective rate for Hourly]).
 * No job-site attribution on this export.
 */
const EXPORT_CSV_HEADERS = [
  'Company ID',
  'Worker ID',
  'Org',
  'Job Number',
  'Job Name',
  'Pay Component',
  'Rate',
  'Rate #',
  'Hours',
  'Units',
  'Line Date',
  'Amount',
  'Check Seq Number',
  'Override State',
  'Override Local',
  'Override Local Jurisdiction',
  'Labor Override',
];

/** Numeric Company ID on SPI rows — same value used in download filenames. */
const PAYCHEX_COMPANY_ID =
  process.env.PAYCHEX_CLIENT_CODE || process.env.PAYCHEX_SPI_COMPANY_ID || '70205967';

const OT_EARNINGS_MULTIPLIER = 1.5;
const DT_EARNINGS_MULTIPLIER = 2;

const EFFECTIVE_RATE_SQL = 'COALESCE(wjsr.rate, w.standard_rate, 0)';

const PAY_COMPONENT = {
  HOURLY: 'Hourly',
  OVERTIME: 'Overtime',
  REIMBURSEMENT: 'Reimbursement',
};

/**
 * Hourly (+ PTO) hours grouped by worker + effective rate.
 * Job site is intentionally not a grouping key.
 */
const HOURLY_BY_RATE_SQL = `
SELECT
  w.id                                   AS worker_db_id,
  TRIM(w.first_name || ' ' || w.last_name) AS worker_name,
  w.employee_code                          AS worker_id,
  w.last_name,
  w.first_name,
  ${EFFECTIVE_RATE_SQL}                    AS hourly_rate,
  COALESCE(SUM(CASE
    WHEN UPPER(te.paychex_component_id::text) IN ('REGULAR', 'HOURLY')
    THEN te.hours ELSE 0 END), 0)          AS hourly_hours,
  COALESCE(SUM(CASE
    WHEN UPPER(te.paychex_component_id::text) IN ('PTO', 'VACATION', 'SICK')
    THEN te.hours ELSE 0 END), 0)          AS pto_hours
FROM time_entries te
JOIN workers w ON te.worker_id = w.id
LEFT JOIN worker_job_site_rates wjsr
  ON wjsr.worker_id = w.id AND wjsr.job_site_id = te.job_site_id
WHERE te.pay_period_id = $1
GROUP BY
  w.id,
  w.first_name,
  w.last_name,
  w.employee_code,
  ${EFFECTIVE_RATE_SQL}
HAVING
  COALESCE(SUM(CASE
    WHEN UPPER(te.paychex_component_id::text) IN ('REGULAR', 'HOURLY')
    THEN te.hours ELSE 0 END), 0)
  + COALESCE(SUM(CASE
    WHEN UPPER(te.paychex_component_id::text) IN ('PTO', 'VACATION', 'SICK')
    THEN te.hours ELSE 0 END), 0) > 0
ORDER BY
  w.last_name,
  w.first_name,
  hourly_rate
`;

/**
 * Worker-level OT/DT hours and reimbursement for the period.
 * Includes workers who only have payroll_adjustments (no time_entries).
 */
const WORKER_EXTRAS_SQL = `
SELECT
  w.id                                   AS worker_db_id,
  TRIM(w.first_name || ' ' || w.last_name) AS worker_name,
  w.employee_code                          AS worker_id,
  w.last_name,
  w.first_name,
  COALESCE(SUM(CASE
    WHEN UPPER(te.paychex_component_id::text) IN ('OT', 'OVERTIME')
    THEN te.hours ELSE 0 END), 0)          AS overtime_hours,
  COALESCE(SUM(CASE
    WHEN UPPER(te.paychex_component_id::text) IN ('DT', 'DOUBLETIME')
    THEN te.hours ELSE 0 END), 0)          AS doubletime_hours,
  COALESCE(SUM(te.reimbursement_amount), 0) AS base_reimbursement_amount,
  pa.id                                    AS adjustment_id,
  COALESCE(pa.reimbursement_amount, 0)     AS adjustment_reimbursement_amount
FROM workers w
INNER JOIN (
  SELECT worker_id FROM time_entries WHERE pay_period_id = $1
  UNION
  SELECT worker_id FROM payroll_adjustments WHERE pay_period_id = $1
) scope ON scope.worker_id = w.id
LEFT JOIN time_entries te
  ON te.worker_id = w.id AND te.pay_period_id = $1
LEFT JOIN payroll_adjustments pa
  ON pa.pay_period_id = $1
 AND pa.worker_id = w.id
GROUP BY
  w.id,
  w.first_name,
  w.last_name,
  w.employee_code,
  pa.id,
  pa.reimbursement_amount
ORDER BY
  w.last_name,
  w.first_name
`;

/** @deprecated Kept for tests/scripts that still import AGGREGATION_SQL. */
const AGGREGATION_SQL = HOURLY_BY_RATE_SQL;

function formatDate(dateStr) {
  if (!dateStr) return '';
  const normalized = String(dateStr).split('T')[0];
  const [year, month, day] = normalized.split('-');
  if (!year || !month || !day) return '';
  return `${month}/${day}/${year}`;
}

function escapeCsvField(value, { forceQuote = false } = {}) {
  if (value == null) return '';
  const str = String(value);
  const isLongNumeric = /^\d{11,}$/.test(str);
  if (
    forceQuote ||
    isLongNumeric ||
    str.includes(',') ||
    str.includes('"') ||
    str.includes('\n') ||
    str.includes('\r')
  ) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function parseNumericField(value) {
  if (value == null || value === '') return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Paychex import-style numbers: whole values without trailing decimals
 * (e.g. 20, 40, 500) matching Paychex_Import.csv samples.
 */
function formatPaychexNumber(value) {
  const n = parseNumericField(value);
  if (!Number.isFinite(n)) return '';
  const rounded = Math.round(n * 10000) / 10000;
  if (Object.is(rounded, -0)) return '0';
  if (Number.isInteger(rounded)) return String(rounded);
  return String(rounded);
}

function formatHours(value) {
  return formatPaychexNumber(value);
}

function formatMoney(value) {
  return formatPaychexNumber(value);
}

function blank() {
  return '';
}

function emptyPaychexRow(overrides = {}) {
  return {
    'Company ID': PAYCHEX_COMPANY_ID,
    'Worker ID': '',
    Org: '',
    'Job Number': '',
    'Job Name': '',
    'Pay Component': '',
    Rate: '',
    'Rate #': '',
    Hours: '',
    Units: '',
    'Line Date': '',
    Amount: '',
    'Check Seq Number': '',
    'Override State': '',
    'Override Local': '',
    'Override Local Jurisdiction': '',
    'Labor Override': '',
    ...overrides,
  };
}

/**
 * Wage helper retained for internal totals/tests. Short pay is no longer part of SPI.
 */
function computeTotalAmount({
  hourlyHours = 0,
  overtimeHours = 0,
  doubletimeHours = 0,
  ptoHours = 0,
  hourlyRate = 0,
  reimbursementAmount = 0,
} = {}) {
  const rate = parseNumericField(hourlyRate);
  const wages =
    parseNumericField(hourlyHours) * rate +
    parseNumericField(ptoHours) * rate +
    parseNumericField(overtimeHours) * rate * OT_EARNINGS_MULTIPLIER +
    parseNumericField(doubletimeHours) * rate * DT_EARNINGS_MULTIPLIER;
  return wages + parseNumericField(reimbursementAmount);
}

function resolveMoneyFields(agg) {
  const baseReimbursement = parseNumericField(agg.base_reimbursement_amount);
  const adjustmentReimbursement = parseNumericField(agg.adjustment_reimbursement_amount);
  const reimbursement = baseReimbursement + adjustmentReimbursement;
  return {
    baseReimbursement,
    reimbursement,
    hasAdjustment: agg.adjustment_id != null,
  };
}

function displayHourlyHours(agg) {
  return parseNumericField(agg.hourly_hours) + parseNumericField(agg.pto_hours);
}

function displayOvertimeHours(agg) {
  return parseNumericField(agg.overtime_hours) + parseNumericField(agg.doubletime_hours);
}

function stripMetadata(row) {
  const cleaned = { ...row };
  delete cleaned._employeeName;
  delete cleaned._workerDbId;
  delete cleaned._payPeriodId;
  delete cleaned._payComponent;
  delete cleaned._hourlyRate;
  delete cleaned._rateMissing;
  delete cleaned._baseReimbursement;
  delete cleaned._hasAdjustment;
  delete cleaned.worker_id;
  return cleaned;
}

function validateSpiRows(rows) {
  const errors = [];

  rows.forEach((row, index) => {
    const cleaned = stripMetadata(row);
    const workerId = cleaned['Worker ID'] ?? cleaned.worker_id;
    const component = cleaned['Pay Component'];
    const hours = parseNumericField(cleaned.Hours);
    const amount = parseNumericField(cleaned.Amount);

    if (!workerId || String(workerId).trim() === '') {
      errors.push({ row: index, reason: 'Worker ID is required' });
    }
    if (!component || String(component).trim() === '') {
      errors.push({ row: index, reason: 'Pay Component is required' });
    }
    if (component === PAY_COMPONENT.HOURLY || component === PAY_COMPONENT.OVERTIME) {
      if (hours <= 0) {
        errors.push({ row: index, reason: `${component} row must have Hours > 0` });
      }
    }
    if (component === PAY_COMPONENT.REIMBURSEMENT && amount <= 0) {
      errors.push({ row: index, reason: 'Reimbursement row must have Amount > 0' });
    }
    if (component === PAY_COMPONENT.OVERTIME && String(cleaned.Rate ?? '').trim() !== '') {
      errors.push({ row: index, reason: 'Overtime Rate must be blank' });
    }
  });

  return errors;
}

function attachMeta(row, { workerName, workerDbId, payPeriodId, payComponent, hourlyRate, rateMissing, baseReimbursement, hasAdjustment }) {
  return {
    ...row,
    worker_id: row['Worker ID'],
    _employeeName: workerName || '',
    _workerDbId: workerDbId,
    _payPeriodId: payPeriodId,
    _payComponent: payComponent,
    _hourlyRate: hourlyRate ?? null,
    _rateMissing: Boolean(rateMissing),
    _baseReimbursement: baseReimbursement ?? 0,
    _hasAdjustment: Boolean(hasAdjustment),
  };
}

async function generateSPIRows(payPeriodId) {
  const periodResult = await query(
    `SELECT id, start_date::text AS start_date, end_date::text AS end_date
     FROM pay_periods
     WHERE id = $1`,
    [payPeriodId]
  );

  if (periodResult.rows.length === 0) {
    return { notFound: true, rows: [], warnings: [], payPeriod: null };
  }

  const payPeriod = periodResult.rows[0];
  const clientCode = process.env.PAYCHEX_CLIENT_CODE || PAYCHEX_COMPANY_ID;
  const warnings = [];

  if (!process.env.PAYCHEX_CLIENT_CODE) {
    warnings.push({
      type: 'warning',
      message: 'PAYCHEX_CLIENT_CODE is not configured — using default Company ID on SPI rows',
    });
  }

  const [hourlyResult, extrasResult] = await Promise.all([
    query(HOURLY_BY_RATE_SQL, [payPeriodId]),
    query(WORKER_EXTRAS_SQL, [payPeriodId]),
  ]);

  const hourlyByWorker = new Map();
  for (const row of hourlyResult.rows) {
    const key = String(row.worker_db_id);
    if (!hourlyByWorker.has(key)) hourlyByWorker.set(key, []);
    hourlyByWorker.get(key).push(row);
  }

  const extrasByWorker = new Map();
  for (const row of extrasResult.rows) {
    extrasByWorker.set(String(row.worker_db_id), row);
  }

  const workerIds = new Set([...hourlyByWorker.keys(), ...extrasByWorker.keys()]);
  const workerOrder = [...workerIds]
    .map((id) => {
      const extra = extrasByWorker.get(id);
      const hourly = hourlyByWorker.get(id)?.[0];
      const src = extra || hourly;
      return {
        id,
        last_name: src?.last_name || '',
        first_name: src?.first_name || '',
        worker_name: src?.worker_name || '',
        worker_id: src?.worker_id != null ? String(src.worker_id) : '',
        worker_db_id: src?.worker_db_id,
      };
    })
    .sort((a, b) => {
      const ln = String(a.last_name).localeCompare(String(b.last_name));
      if (ln !== 0) return ln;
      const fn = String(a.first_name).localeCompare(String(b.first_name));
      if (fn !== 0) return fn;
      return String(a.worker_id).localeCompare(String(b.worker_id));
    });

  const rows = [];
  let checkSeq = 0;

  for (const worker of workerOrder) {
    const key = worker.id;
    const hourlyGroups = hourlyByWorker.get(key) || [];
    const extras = extrasByWorker.get(key) || {};
    const overtimeHours = displayOvertimeHours(extras);
    const { baseReimbursement, reimbursement, hasAdjustment } = resolveMoneyFields(extras);
    const workerId = worker.worker_id;
    const workerName = worker.worker_name;

    const hasHourly = hourlyGroups.some((g) => displayHourlyHours(g) > 0);
    const hasOt = overtimeHours > 0;
    const hasReimb = reimbursement > 0;

    if (!hasHourly && !hasOt && !hasReimb) {
      continue;
    }

    checkSeq += 1;
    const seq = String(checkSeq);

    for (const group of hourlyGroups) {
      const hours = displayHourlyHours(group);
      if (hours <= 0) continue;

      const rateRaw = group.hourly_rate;
      const rateMissing =
        rateRaw == null || rateRaw === '' || !Number.isFinite(Number(rateRaw));
      const hourlyRate = rateMissing ? 0 : parseNumericField(rateRaw);

      if (rateMissing) {
        warnings.push({
          type: 'warning',
          message: `Missing Hourly Rate for ${workerName} — Rate left blank until a rate is set`,
        });
      }

      rows.push(
        attachMeta(
          emptyPaychexRow({
            'Worker ID': workerId,
            'Pay Component': PAY_COMPONENT.HOURLY,
            Rate: rateMissing ? blank() : formatPaychexNumber(hourlyRate),
            Hours: formatPaychexNumber(hours),
            'Check Seq Number': seq,
          }),
          {
            workerName,
            workerDbId: worker.worker_db_id,
            payPeriodId,
            payComponent: PAY_COMPONENT.HOURLY,
            hourlyRate,
            rateMissing,
            baseReimbursement,
            hasAdjustment,
          }
        )
      );
    }

    if (hasOt) {
      rows.push(
        attachMeta(
          emptyPaychexRow({
            'Worker ID': workerId,
            'Pay Component': PAY_COMPONENT.OVERTIME,
            Hours: formatPaychexNumber(overtimeHours),
            'Check Seq Number': seq,
          }),
          {
            workerName,
            workerDbId: worker.worker_db_id,
            payPeriodId,
            payComponent: PAY_COMPONENT.OVERTIME,
            baseReimbursement,
            hasAdjustment,
          }
        )
      );
    }

    if (hasReimb) {
      rows.push(
        attachMeta(
          emptyPaychexRow({
            'Worker ID': workerId,
            'Pay Component': PAY_COMPONENT.REIMBURSEMENT,
            Amount: formatPaychexNumber(reimbursement),
            'Check Seq Number': seq,
          }),
          {
            workerName,
            workerDbId: worker.worker_db_id,
            payPeriodId,
            payComponent: PAY_COMPONENT.REIMBURSEMENT,
            baseReimbursement,
            hasAdjustment,
          }
        )
      );
    }
  }

  return {
    notFound: false,
    rows,
    warnings,
    clientCode,
    companyId: PAYCHEX_COMPANY_ID,
    payPeriod: {
      start_date: payPeriod.start_date,
      end_date: payPeriod.end_date,
    },
  };
}

function generateSPICSV(rows, clientCode) {
  const code = clientCode || process.env.PAYCHEX_CLIENT_CODE || PAYCHEX_COMPANY_ID;
  const filename = `${code}_ta.csv`;
  const lines = [EXPORT_CSV_HEADERS.join(',')];

  for (const row of rows) {
    const cleaned = stripMetadata(row);
    const fields = EXPORT_CSV_HEADERS.map((header) => {
      const value = cleaned[header] ?? '';
      return escapeCsvField(value);
    });
    lines.push(fields.join(','));
  }

  const csvString = lines.join('\n');
  return { csvString, filename };
}

/**
 * Delete all daily + aggregated time entries for a worker in the period.
 * SPI rows are pay-component based (no job-site scope on this export).
 */
async function deletePayrollRow({ payPeriodId, workerDbId }) {
  const periodResult = await query('SELECT status FROM pay_periods WHERE id = $1', [payPeriodId]);
  if (periodResult.rows.length === 0) {
    const error = new Error('Pay period not found');
    error.statusCode = 404;
    throw error;
  }
  if (periodResult.rows[0].status !== 'OPEN') {
    const error = new Error('Pay period is not open for edits');
    error.statusCode = 400;
    throw error;
  }

  await query(
    `DELETE FROM daily_time_entries
     WHERE pay_period_id = $1
       AND worker_id = $2`,
    [payPeriodId, workerDbId]
  );

  const result = await query(
    `DELETE FROM time_entries
     WHERE pay_period_id = $1
       AND worker_id = $2
     RETURNING id`,
    [payPeriodId, workerDbId]
  );

  return result.rowCount;
}

function sumRowHours(row) {
  if (row['Pay Component'] === PAY_COMPONENT.HOURLY || row['Pay Component'] === PAY_COMPONENT.OVERTIME) {
    return parseNumericField(row.Hours);
  }
  // Legacy wide-row shape (tests / older callers)
  return parseNumericField(row['Hourly Hours']) + parseNumericField(row['Overtime Hours']);
}

module.exports = {
  EXPORT_CSV_HEADERS,
  PAYCHEX_COMPANY_ID,
  PAY_COMPONENT,
  AGGREGATION_SQL,
  HOURLY_BY_RATE_SQL,
  WORKER_EXTRAS_SQL,
  OT_EARNINGS_MULTIPLIER,
  DT_EARNINGS_MULTIPLIER,
  formatDate,
  escapeCsvField,
  formatHours,
  formatMoney,
  formatPaychexNumber,
  computeTotalAmount,
  displayHourlyHours,
  displayOvertimeHours,
  resolveMoneyFields,
  generateSPIRows,
  generateSPICSV,
  validateSpiRows,
  stripMetadata,
  deletePayrollRow,
  sumRowHours,
  parseNumericField,
};
