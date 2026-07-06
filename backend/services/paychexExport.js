const { query } = require('../db');

const SPI_CSV_HEADERS = [
  'Company ID',
  'Worker ID',
  'Org',
  'Job Number',
  'Pay Component',
  'Hours',
  'Rate',
  'Amount',
  'Start Date',
  'End Date',
];

const HOURS_PAY_CODES = new Set(['REGULAR', 'OT', 'PTO']);

const AGGREGATION_SQL = `
SELECT
  w.employee_code          AS worker_id,
  w.first_name,
  w.last_name,
  js.paychex_job_id        AS job_number,
  js.name                  AS job_name,
  CASE
    WHEN te.reimbursement_amount > 0 THEN 'REIMBURSE'
    ELSE te.paychex_component_id
  END                      AS pay_code,
  SUM(te.hours)            AS total_hours,
  SUM(te.reimbursement_amount) AS total_amount,
  MAX(
    CASE WHEN te.reimbursement_amount > 0 THEN te.component_name END
  )                        AS entry_reimburse_component_name,
  (
    SELECT wpc.name
    FROM worker_pay_components wpc
    WHERE wpc.worker_id = w.id
      AND wpc.name ILIKE '%reimburse%'
    LIMIT 1
  )                        AS worker_reimburse_component_name
FROM time_entries te
JOIN workers w    ON w.id = te.worker_id
JOIN job_sites js ON js.id = te.job_site_id
WHERE te.pay_period_id = $1
  AND w.employee_code IS NOT NULL
  AND w.employee_code != ''
  AND (te.hours > 0 OR te.reimbursement_amount > 0)
GROUP BY
  w.id, w.employee_code, w.first_name, w.last_name,
  js.id, js.paychex_job_id, js.name,
  CASE
    WHEN te.reimbursement_amount > 0 THEN 'REIMBURSE'
    ELSE te.paychex_component_id
  END
ORDER BY w.last_name, w.first_name, js.name, pay_code
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

function resolvePayComponentName(payCode, entryReimburseName, workerReimburseName) {
  switch (payCode) {
    case 'REGULAR':
      return process.env.PAYCHEX_REGULAR_COMPONENT_NAME || 'Regular';
    case 'OT':
      return process.env.PAYCHEX_OT_COMPONENT_NAME || 'Overtime';
    case 'PTO':
      return process.env.PAYCHEX_PTO_COMPONENT_NAME || 'PTO';
    case 'REIMBURSE':
      return (
        entryReimburseName ||
        workerReimburseName ||
        process.env.PAYCHEX_REIMBURSE_COMPONENT_NAME ||
        'Reimbursement'
      );
    default:
      return '';
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
  delete cleaned._workerName;
  delete cleaned._jobName;
  delete cleaned._payCode;
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
    const workerId = cleaned['Worker ID'];
    const payComponent = cleaned['Pay Component'];
    const hours = parseNumericField(cleaned.Hours);
    const amount = parseNumericField(cleaned.Amount);

    if (!companyId || String(companyId).trim() === '') {
      errors.push({ row: index, reason: 'Company ID is required' });
    }
    if (!workerId || String(workerId).trim() === '') {
      errors.push({ row: index, reason: 'Worker ID is required' });
    }
    if (!payComponent || String(payComponent).trim() === '') {
      errors.push({ row: index, reason: 'Pay Component is required' });
    }
    if (hours <= 0 && amount <= 0) {
      errors.push({ row: index, reason: 'Row must have Hours > 0 or Amount > 0' });
    }
    if (hours > 0 && amount > 0) {
      errors.push({ row: index, reason: 'Hours and Amount cannot both be populated' });
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
  const startDate = formatDate(payPeriod.start_date);
  const endDate = formatDate(payPeriod.end_date);
  const warnings = [];

  if (!clientCode) {
    warnings.push({
      type: 'error',
      message: 'PAYCHEX_CLIENT_CODE is not configured',
    });
  }

  const skippedWorkers = await query(
    `SELECT DISTINCT w.first_name, w.last_name
     FROM time_entries te
     JOIN workers w ON w.id = te.worker_id
     WHERE te.pay_period_id = $1
       AND (w.employee_code IS NULL OR w.employee_code = '')
       AND (te.hours > 0 OR te.reimbursement_amount > 0)`,
    [payPeriodId]
  );

  for (const worker of skippedWorkers.rows) {
    const name = `${worker.first_name} ${worker.last_name}`;
    console.warn(`[paychexExport] Skipping worker without employee_code: ${name}`);
    warnings.push({
      type: 'warning',
      message: `Skipped ${name}: missing Paychex Worker ID (employee_code)`,
    });
  }

  const aggResult = await query(AGGREGATION_SQL, [payPeriodId]);
  const rows = [];

  for (const agg of aggResult.rows) {
    const payCode = agg.pay_code;
    const payComponentName = resolvePayComponentName(
      payCode,
      agg.entry_reimburse_component_name,
      agg.worker_reimburse_component_name
    );

    if (!payComponentName || !payComponentName.trim()) {
      const name = `${agg.first_name} ${agg.last_name}`;
      console.error(
        `[paychexExport] Skipping row for ${name}: blank Pay Component for pay code ${payCode}`
      );
      warnings.push({
        type: 'error',
        message: `Skipped ${name} at ${agg.job_name || 'unknown job'}: Pay Component name is blank`,
      });
      continue;
    }

    if (!agg.job_number) {
      const name = `${agg.first_name} ${agg.last_name}`;
      console.warn(`[paychexExport] Missing job number for ${name} at ${agg.job_name}`);
      warnings.push({
        type: 'warning',
        message: `Missing Job Number for ${name} at ${agg.job_name || 'unknown job'}`,
      });
    }

    const isHours = isHoursPayCode(payCode);
    const isReimbursement = isReimbursementPayCode(payCode);
    const totalHours = parseFloat(agg.total_hours) || 0;
    const totalAmount = parseFloat(agg.total_amount) || 0;

    rows.push({
      'Company ID': clientCode,
      'Worker ID': String(agg.worker_id),
      Org: '',
      'Job Number': agg.job_number ? String(agg.job_number) : '',
      'Pay Component': payComponentName,
      Hours: isHours && totalHours > 0 ? totalHours.toFixed(2) : '',
      Rate: '',
      Amount: isReimbursement && totalAmount > 0 ? totalAmount.toFixed(2) : '',
      'Start Date': startDate,
      'End Date': endDate,
      _workerName: `${agg.first_name} ${agg.last_name}`,
      _jobName: agg.job_name || '',
      _payCode: payCode,
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
  const lines = [SPI_CSV_HEADERS.join(',')];

  for (const row of rows) {
    const cleaned = stripMetadata(row);
    const fields = SPI_CSV_HEADERS.map((header) => {
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

module.exports = {
  SPI_CSV_HEADERS,
  formatDate,
  escapeCsvField,
  generateSPIRows,
  generateSPICSV,
  validateSpiRows,
  stripMetadata,
};
