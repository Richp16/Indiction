const { query } = require('../db');
const {
  getPayCodeDefinition,
  resolveHoursComponentId,
  isHoursPayCode,
  isReimbursementComponentName,
  getConfiguredComponentId,
} = require('../config/paychex');
const { mapPaychexComponentToPayCode } = require('../config/payCodeMapping');

class ExportConfigError extends Error {
  constructor(message, payCode) {
    super(message);
    this.payCode = payCode;
    this.name = 'ExportConfigError';
  }
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
  const internalPayCode = mapPaychexComponentToPayCode(storedComponentId);

  if (isHoursPayCode(internalPayCode)) {
    const componentId = resolveHoursComponentId(internalPayCode);
    if (!componentId) {
      const definition = getPayCodeDefinition(internalPayCode);
      throw new ExportConfigError(
        `Pay code ${internalPayCode} is not mapped to a Paychex pay item; configure ${definition?.envKey}.`,
        internalPayCode
      );
    }
    return {
      componentId,
      entryType: 'HOURS',
      payCode: internalPayCode,
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
  js.job_code,
  js.name                        AS job_site_name,
  te.paychex_component_id        AS stored_component_id,
  SUM(te.hours)                  AS total_hours,
  SUM(te.reimbursement_amount)   AS total_reimbursement
FROM time_entries te
JOIN workers w    ON te.worker_id   = w.id
JOIN job_sites js ON te.job_site_id = js.id
WHERE te.pay_period_id = $1
GROUP BY w.id, w.paychex_worker_id, w.employee_code, w.first_name, w.last_name,
         w.standard_rate, js.job_code, js.name, te.paychex_component_id
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
        job_code: row.job_code,
        jobSiteName: row.job_site_name,
        entryType: resolved.entryType,
        payCode: resolved.payCode,
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

async function validateExportConfig(payPeriodId) {
  const { configErrors } = await buildSubmissionPayload(payPeriodId);
  return configErrors;
}

module.exports = {
  ExportConfigError,
  buildSubmissionPayload,
  validateExportConfig,
};
