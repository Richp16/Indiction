const { query } = require('../db');
const { mapPayCodeToPaychexComponent, mapPaychexComponentToPayCode } = require('../config/payCodeMapping');

const EXPORT_CSV_HEADERS = [
  'Company ID',
  'Worker ID',
  'Employee Name',
  'Job Number',
  'Job Name',
  'Pay Component',
  'Hours',
];

const HOURS_PAY_CODES = new Set(['REGULAR', 'OT', 'PTO', 'HOURLY', 'OVERTIME', 'DOUBLETIME']);

const AGGREGATION_SQL = `
SELECT
  w.id                                   AS worker_db_id,
  TRIM(w.first_name || ' ' || w.last_name) AS worker_name,
  w.employee_code                          AS worker_id,
  te.job_site_id,
  js.job_code                              AS job_number,
  js.name                                  AS job_name,
  te.paychex_component_id                  AS pay_component,
  SUM(te.hours)                            AS hours,
  SUM(te.reimbursement_amount)             AS amount,
  MAX(te.component_name)                   AS component_name,
  pp.start_date::text                      AS start_date,
  pp.end_date::text                        AS end_date
FROM time_entries te
JOIN workers w ON te.worker_id = w.id
LEFT JOIN job_sites js ON te.job_site_id = js.id
JOIN pay_periods pp ON te.pay_period_id = pp.id
WHERE te.pay_period_id = $1
  AND (te.hours > 0 OR te.reimbursement_amount > 0)
GROUP BY
  w.id,
  w.first_name,
  w.last_name,
  w.employee_code,
  te.job_site_id,
  js.job_code,
  js.name,
  te.paychex_component_id,
  pp.start_date,
  pp.end_date
ORDER BY
  w.last_name,
  w.first_name,
  COALESCE(js.name, 'General'),
  te.paychex_component_id
`;

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

function resolvePayComponentName(payCode, componentName) {
  switch (payCode) {
    case 'REGULAR':
    case 'HOURLY':
      return process.env.PAYCHEX_REGULAR_COMPONENT_NAME || 'Regular';
    case 'OT':
    case 'OVERTIME':
      return process.env.PAYCHEX_OT_COMPONENT_NAME || 'Overtime';
    case 'DT':
    case 'DOUBLETIME':
      return process.env.PAYCHEX_DT_COMPONENT_NAME || 'Double Time';
    case 'PTO':
      return process.env.PAYCHEX_PTO_COMPONENT_NAME || 'PTO';
    case 'REIMBURSE':
      return (
        componentName ||
        process.env.PAYCHEX_REIMBURSE_COMPONENT_NAME ||
        'Reimbursement'
      );
    default:
      return componentName || '';
  }
}

function isHoursPayCode(payCode) {
  return HOURS_PAY_CODES.has(payCode);
}

function isReimbursementPayCode(payCode) {
  return payCode === 'REIMBURSE';
}

function stripMetadata(row) {
  const cleaned = { ...row };
  delete cleaned._employeeName;
  delete cleaned._jobName;
  delete cleaned._payCode;
  delete cleaned._workerDbId;
  delete cleaned._jobSiteId;
  delete cleaned._payPeriodId;
  delete cleaned.worker_id;
  return cleaned;
}

function parseNumericField(value) {
  if (value == null || value === '') return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function validateSpiRows(rows) {
  const errors = [];

  rows.forEach((row, index) => {
    const cleaned = stripMetadata(row);
    const companyId = cleaned['Company ID'];
    const workerId = cleaned.worker_id ?? cleaned['Worker ID'];
    const payComponent = cleaned['Pay Component'];
    const hours = parseNumericField(cleaned.Hours);

    if (!companyId || String(companyId).trim() === '') {
      errors.push({ row: index, reason: 'Company ID is required' });
    }
    if (!workerId || String(workerId).trim() === '') {
      errors.push({ row: index, reason: 'Worker ID is required' });
    }
    if (!payComponent || String(payComponent).trim() === '') {
      errors.push({ row: index, reason: 'Pay Component is required' });
    }
    if (hours <= 0) {
      errors.push({ row: index, reason: 'Hours must be greater than 0' });
    }
  });

  return errors;
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
  const clientCode = process.env.PAYCHEX_CLIENT_CODE || '';
  const warnings = [];

  if (!clientCode) {
    warnings.push({
      type: 'error',
      message: 'PAYCHEX_CLIENT_CODE is not configured',
    });
  }

  const aggResult = await query(AGGREGATION_SQL, [payPeriodId]);
  const rows = [];

  for (const agg of aggResult.rows) {
    const payCode = agg.pay_component;
    const payComponentName = resolvePayComponentName(payCode, agg.component_name);
    const totalHours = parseFloat(agg.hours) || 0;
    const jobNumber = agg.job_number ? String(agg.job_number) : '';

    if (totalHours <= 0) {
      continue;
    }

    if (!payComponentName || !payComponentName.trim()) {
      warnings.push({
        type: 'error',
        message: `Skipped ${agg.worker_name} at ${agg.job_name || 'unknown job'}: Pay Component name is blank`,
      });
      continue;
    }

    if (!jobNumber) {
      console.warn(`[paychexExport] Missing job number for ${agg.worker_name} at ${agg.job_name}`);
      warnings.push({
        type: 'warning',
        message: `Missing Job Number for ${agg.worker_name} at ${agg.job_name || 'unknown job'}`,
      });
    }

    const workerId = agg.worker_id != null ? String(agg.worker_id) : '';

    rows.push({
      worker_id: workerId,
      'Company ID': clientCode,
      'Worker ID': workerId,
      'Employee Name': agg.worker_name,
      'Job Number': jobNumber,
      'Job Name': agg.job_name || 'General',
      'Pay Component': payComponentName,
      Hours: totalHours.toFixed(2),
      _employeeName: agg.worker_name,
      _jobName: agg.job_name || 'General',
      _payCode: payCode,
      _workerDbId: agg.worker_db_id,
      _jobSiteId: agg.job_site_id,
      _payPeriodId: payPeriodId,
    });
  }

  return {
    notFound: false,
    rows,
    warnings,
    clientCode: process.env.PAYCHEX_CLIENT_CODE || 'payroll',
    payPeriod: {
      start_date: payPeriod.start_date,
      end_date: payPeriod.end_date,
    },
  };
}

function generateSPICSV(rows, clientCode) {
  const code = clientCode || process.env.PAYCHEX_CLIENT_CODE || 'payroll';
  const filename = `${code}_ta.csv`;
  const lines = [EXPORT_CSV_HEADERS.join(',')];

  for (const row of rows) {
    const cleaned = stripMetadata(row);
    const fields = EXPORT_CSV_HEADERS.map((header) => {
      const value = cleaned[header] ?? '';
      if (header === 'Job Number') {
        return escapeCsvField(value, { forceQuote: true });
      }
      return escapeCsvField(value);
    });
    lines.push(fields.join(','));
  }

  const csvString = lines.join('\n');
  return { csvString, filename };
}

async function deletePayrollRow({ payPeriodId, workerDbId, jobSiteId, payComponent }) {
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

  const internalPayCode = mapPaychexComponentToPayCode(payComponent);
  const aggregatedComponentId = mapPayCodeToPaychexComponent(internalPayCode);

  await query(
    `DELETE FROM daily_time_entries
     WHERE pay_period_id = $1
       AND worker_id = $2
       AND pay_code = $3
       AND (
         ($4::uuid IS NULL AND job_site_id IS NULL)
         OR job_site_id = $4::uuid
       )`,
    [payPeriodId, workerDbId, internalPayCode, jobSiteId || null]
  );

  const result = await query(
    `DELETE FROM time_entries
     WHERE pay_period_id = $1
       AND worker_id = $2
       AND paychex_component_id = $3
       AND (
         ($4::uuid IS NULL AND job_site_id IS NULL)
         OR job_site_id = $4::uuid
       )
     RETURNING id`,
    [payPeriodId, workerDbId, aggregatedComponentId, jobSiteId || null]
  );

  return result.rowCount;
}

module.exports = {
  EXPORT_CSV_HEADERS,
  formatDate,
  escapeCsvField,
  generateSPIRows,
  generateSPICSV,
  validateSpiRows,
  stripMetadata,
  deletePayrollRow,
};
