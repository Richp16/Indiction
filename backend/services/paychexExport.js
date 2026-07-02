const { query } = require('../db');
const {
  PAY_CODE_DEFINITIONS,
  getPayCodeDefinition,
  resolveHoursComponentId,
  isHoursPayCode,
  isReimbursementComponentName,
  getConfiguredComponentId,
} = require('../config/paychex');

const HOURS_SPI_COLUMNS = {
  REGULAR: 'Regular Hours',
  OT: 'Overtime Hours',
  PTO: 'PTO Hours',
};

const SPI_CSV_HEADERS = [
  'Employee ID',
  'First Name',
  'Last Name',
  'Job Site',
  'Regular Hours',
  'Overtime Hours',
  'PTO Hours',
  'Reimbursement Amount',
  'Reimbursement Pay Item',
];

class ExportConfigError extends Error {
  constructor(message, payCode) {
    super(message);
    this.payCode = payCode;
    this.name = 'ExportConfigError';
  }
}

function getHoursSpiColumn(payCode) {
  return HOURS_SPI_COLUMNS[payCode] || getPayCodeDefinition(payCode)?.label || payCode;
}

async function loadWorkerReimbursementComponents(workerId) {
  const result = await query(
    `SELECT paychex_component_id, name
     FROM worker_pay_components
     WHERE worker_id = $1
     ORDER BY name`,
    [workerId]
  );
  return result.rows.filter((row) => isReimbursementComponentName(row.name));
}

function resolveReimbursementExportComponentId(storedComponentId, workerReimbComponents) {
  if (storedComponentId && storedComponentId !== 'REIMBURSE') {
    return storedComponentId;
  }

  const envId = getConfiguredComponentId('PAYCHEX_REIMBURSE_COMPONENT_ID');
  if (envId) {
    return envId;
  }

  return workerReimbComponents[0]?.paychex_component_id || null;
}

function resolveExportPaychexComponentId({ storedComponentId, workerReimbComponents }) {
  if (isHoursPayCode(storedComponentId)) {
    const componentId = resolveHoursComponentId(storedComponentId);
    if (!componentId) {
      const definition = getPayCodeDefinition(storedComponentId);
      throw new ExportConfigError(
        `Pay code ${storedComponentId} is not mapped to a Paychex pay item; configure ${definition?.envKey}.`,
        storedComponentId
      );
    }
    return {
      componentId,
      entryType: 'HOURS',
      payCode: storedComponentId,
      spiColumn: getHoursSpiColumn(storedComponentId),
    };
  }

  const componentId = resolveReimbursementExportComponentId(
    storedComponentId,
    workerReimbComponents
  );

  if (!componentId) {
    throw new ExportConfigError(
      'Reimbursement pay code is not mapped to a Paychex reimbursement component for this worker.',
      'REIMBURSE'
    );
  }

  return {
    componentId,
    entryType: 'REIMBURSEMENT',
    payCode: 'REIMBURSE',
    spiColumn: 'Reimbursement Amount',
  };
}

const SUBMISSION_AGGREGATION_SQL = `
SELECT
  w.id                         AS worker_db_id,
  w.paychex_worker_id,
  w.employee_code,
  w.first_name,
  w.last_name,
  w.standard_rate,
  js.paychex_job_id,
  js.name                        AS job_site_name,
  te.paychex_component_id        AS stored_component_id,
  SUM(te.hours)                  AS total_hours,
  SUM(te.reimbursement_amount)   AS total_reimbursement
FROM time_entries te
JOIN workers w    ON te.worker_id   = w.id
JOIN job_sites js ON te.job_site_id = js.id
WHERE te.pay_period_id = $1
GROUP BY w.id, w.paychex_worker_id, w.employee_code, w.first_name, w.last_name,
         w.standard_rate, js.paychex_job_id, js.name, te.paychex_component_id
`;

async function buildSubmissionPayload(payPeriodId) {
  const aggResult = await query(SUBMISSION_AGGREGATION_SQL, [payPeriodId]);
  const configErrors = [];
  const byWorker = new Map();
  const reimbComponentsCache = new Map();

  for (const row of aggResult.rows) {
    const workerKey = row.paychex_worker_id;
    if (!byWorker.has(workerKey)) {
      byWorker.set(workerKey, {
        workerDbId: row.worker_db_id,
        paychexWorkerId: row.paychex_worker_id,
        employeeCode: row.employee_code,
        workerName: `${row.first_name} ${row.last_name}`,
        standardRate: row.standard_rate != null ? parseFloat(row.standard_rate) : null,
        lines: [],
      });
    }

    const worker = byWorker.get(workerKey);

    try {
      if (!reimbComponentsCache.has(row.worker_db_id)) {
        reimbComponentsCache.set(
          row.worker_db_id,
          await loadWorkerReimbursementComponents(row.worker_db_id)
        );
      }

      const resolved = resolveExportPaychexComponentId({
        storedComponentId: row.stored_component_id,
        workerReimbComponents: reimbComponentsCache.get(row.worker_db_id),
      });

      worker.lines.push({
        paychexComponentId: resolved.componentId,
        paychexJobId: row.paychex_job_id,
        jobSiteName: row.job_site_name,
        entryType: resolved.entryType,
        payCode: resolved.payCode,
        spiColumn: resolved.spiColumn,
        totalHours: parseFloat(row.total_hours) || 0,
        totalReimbursement: parseFloat(row.total_reimbursement) || 0,
      });
    } catch (error) {
      if (error instanceof ExportConfigError) {
        configErrors.push({
          type: 'error',
          workerId: row.worker_db_id,
          workerName: worker.workerName,
          payCode: error.payCode,
          message: error.message,
        });
      } else {
        throw error;
      }
    }
  }

  return {
    workers: [...byWorker.values()],
    configErrors,
  };
}

function buildSpiRows(workers) {
  const rowsByKey = new Map();

  for (const worker of workers) {
    for (const line of worker.lines) {
      const key = `${worker.workerDbId}:${line.paychexJobId}`;
      if (!rowsByKey.has(key)) {
        rowsByKey.set(key, {
          employeeId: worker.employeeCode || '',
          firstName: worker.workerName.split(' ')[0] || '',
          lastName: worker.workerName.split(' ').slice(1).join(' ') || '',
          jobSite: line.jobSiteName || '',
          regularHours: 0,
          overtimeHours: 0,
          ptoHours: 0,
          reimbursementAmount: 0,
          reimbursementPayItem: '',
        });
      }

      const spiRow = rowsByKey.get(key);

      if (line.entryType === 'HOURS' && line.totalHours > 0) {
        if (line.payCode === 'REGULAR') {
          spiRow.regularHours += line.totalHours;
        } else if (line.payCode === 'OT') {
          spiRow.overtimeHours += line.totalHours;
        } else if (line.payCode === 'PTO') {
          spiRow.ptoHours += line.totalHours;
        }
      }

      if (line.entryType === 'REIMBURSEMENT' && line.totalReimbursement > 0) {
        spiRow.reimbursementAmount += line.totalReimbursement;
        spiRow.reimbursementPayItem = line.paychexComponentId;
      }
    }
  }

  return [...rowsByKey.values()];
}

function escapeCSV(value) {
  const str = value == null ? '' : String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function buildSpiCsv(workers) {
  const spiRows = buildSpiRows(workers);
  const lines = [SPI_CSV_HEADERS.join(',')];

  for (const row of spiRows) {
    lines.push(
      [
        row.employeeId,
        row.firstName,
        row.lastName,
        row.jobSite,
        row.regularHours,
        row.overtimeHours,
        row.ptoHours,
        row.reimbursementAmount,
        row.reimbursementPayItem,
      ]
        .map(escapeCSV)
        .join(',')
    );
  }

  return lines.join('\n');
}

async function validateExportConfig(payPeriodId) {
  const { configErrors } = await buildSubmissionPayload(payPeriodId);
  return configErrors;
}

module.exports = {
  PAY_CODE_DEFINITIONS,
  HOURS_SPI_COLUMNS,
  SPI_CSV_HEADERS,
  ExportConfigError,
  getHoursSpiColumn,
  resolveExportPaychexComponentId,
  buildSubmissionPayload,
  buildSpiRows,
  buildSpiCsv,
  validateExportConfig,
};
