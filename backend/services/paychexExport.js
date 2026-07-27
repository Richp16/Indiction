const { query } = require('../db');

/**
 * SPI / payroll export columns (one row per worker per pay period).
 * Hourly and Overtime are pivoted into columns; hours are summed across all job sites.
 */
const EXPORT_CSV_HEADERS = [
  'Name',
  'Employee ID',
  'Total Amount',
  'Hourly Hours',
  'Hourly Rate',
  'Overtime Hours',
  'Reimbursement Amount',
  'Short Pay Amount',
];

const OT_EARNINGS_MULTIPLIER = 1.5;
const DT_EARNINGS_MULTIPLIER = 2;

/** Short Pay defaults to 0 unless set via payroll_adjustments (Payroll page). */
const SHORT_PAY_SOURCE_NOTE =
  'Short Pay Amount is stored in payroll_adjustments; rows default to 0.00 until edited and saved.';

const AGGREGATION_SQL = `
SELECT
  w.id                                   AS worker_db_id,
  TRIM(w.first_name || ' ' || w.last_name) AS worker_name,
  w.employee_code                          AS worker_id,
  w.standard_rate                          AS hourly_rate,
  COALESCE(SUM(CASE
    WHEN UPPER(te.paychex_component_id::text) IN ('REGULAR', 'HOURLY')
    THEN te.hours ELSE 0 END), 0)          AS hourly_hours,
  COALESCE(SUM(CASE
    WHEN UPPER(te.paychex_component_id::text) IN ('OT', 'OVERTIME')
    THEN te.hours ELSE 0 END), 0)          AS overtime_hours,
  COALESCE(SUM(CASE
    WHEN UPPER(te.paychex_component_id::text) IN ('DT', 'DOUBLETIME')
    THEN te.hours ELSE 0 END), 0)          AS doubletime_hours,
  COALESCE(SUM(CASE
    WHEN UPPER(te.paychex_component_id::text) IN ('PTO', 'VACATION', 'SICK')
    THEN te.hours ELSE 0 END), 0)          AS pto_hours,
  COALESCE(SUM(te.reimbursement_amount), 0) AS base_reimbursement_amount,
  pa.id                                    AS adjustment_id,
  COALESCE(pa.reimbursement_amount, 0)     AS adjustment_reimbursement_amount,
  COALESCE(pa.short_pay_amount, 0)         AS short_pay_amount,
  -- Dollar total summed across job sites at the worker's standard rate (rate is worker-level).
  COALESCE(SUM(
    CASE
      WHEN UPPER(te.paychex_component_id::text) IN ('REGULAR', 'HOURLY')
        THEN te.hours * COALESCE(w.standard_rate, 0)
      WHEN UPPER(te.paychex_component_id::text) IN ('PTO', 'VACATION', 'SICK')
        THEN te.hours * COALESCE(w.standard_rate, 0)
      WHEN UPPER(te.paychex_component_id::text) IN ('OT', 'OVERTIME')
        THEN te.hours * COALESCE(w.standard_rate, 0) * ${OT_EARNINGS_MULTIPLIER}
      WHEN UPPER(te.paychex_component_id::text) IN ('DT', 'DOUBLETIME')
        THEN te.hours * COALESCE(w.standard_rate, 0) * ${DT_EARNINGS_MULTIPLIER}
      ELSE 0
    END
  ), 0)                                    AS wage_amount,
  pp.start_date::text                      AS start_date,
  pp.end_date::text                        AS end_date
FROM time_entries te
JOIN workers w ON te.worker_id = w.id
JOIN pay_periods pp ON te.pay_period_id = pp.id
LEFT JOIN payroll_adjustments pa
  ON pa.pay_period_id = pp.id
 AND pa.worker_id = w.id
WHERE te.pay_period_id = $1
  AND (te.hours > 0 OR te.reimbursement_amount > 0 OR pa.id IS NOT NULL)
GROUP BY
  w.id,
  w.first_name,
  w.last_name,
  w.employee_code,
  w.standard_rate,
  pp.start_date,
  pp.end_date,
  pa.id,
  pa.reimbursement_amount,
  pa.short_pay_amount
ORDER BY
  w.last_name,
  w.first_name
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

function parseNumericField(value) {
  if (value == null || value === '') return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatHours(value) {
  return parseNumericField(value).toFixed(1);
}

function formatMoney(value) {
  return parseNumericField(value).toFixed(2);
}

/**
 * Wage + reimbursement − short pay.
 * PTO is straight time; double-time uses 2× for earnings while hours roll into Overtime Hours.
 */
function computeTotalAmount({
  hourlyHours = 0,
  overtimeHours = 0,
  doubletimeHours = 0,
  ptoHours = 0,
  hourlyRate = 0,
  reimbursementAmount = 0,
  shortPayAmount = 0,
} = {}) {
  const rate = parseNumericField(hourlyRate);
  const wages =
    parseNumericField(hourlyHours) * rate +
    parseNumericField(ptoHours) * rate +
    parseNumericField(overtimeHours) * rate * OT_EARNINGS_MULTIPLIER +
    parseNumericField(doubletimeHours) * rate * DT_EARNINGS_MULTIPLIER;
  return (
    wages +
    parseNumericField(reimbursementAmount) -
    parseNumericField(shortPayAmount)
  );
}

/**
 * Final SPI money fields: time_entries base + payroll_adjustments deltas.
 * Short pay has no time_entries source yet — adjustment (or 0) is the full value.
 */
function resolveMoneyFields(agg) {
  const baseReimbursement = parseNumericField(agg.base_reimbursement_amount);
  const adjustmentReimbursement = parseNumericField(agg.adjustment_reimbursement_amount);
  const reimbursement = baseReimbursement + adjustmentReimbursement;
  const shortPay = parseNumericField(agg.short_pay_amount);
  return {
    baseReimbursement,
    reimbursement,
    shortPay,
    hasAdjustment: agg.adjustment_id != null,
  };
}

/** Display Hourly Hours includes PTO so period hour totals still reconcile. */
function displayHourlyHours(agg) {
  return parseNumericField(agg.hourly_hours) + parseNumericField(agg.pto_hours);
}

/** Display Overtime Hours includes double-time hours for the same reason. */
function displayOvertimeHours(agg) {
  return parseNumericField(agg.overtime_hours) + parseNumericField(agg.doubletime_hours);
}

function stripMetadata(row) {
  const cleaned = { ...row };
  delete cleaned._employeeName;
  delete cleaned._jobName;
  delete cleaned._jobNumber;
  delete cleaned._workerDbId;
  delete cleaned._jobSiteId;
  delete cleaned._payPeriodId;
  delete cleaned._hourlyHoursRaw;
  delete cleaned._overtimeHoursRaw;
  delete cleaned._doubletimeHours;
  delete cleaned._ptoHours;
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
    const employeeId = cleaned['Employee ID'] ?? cleaned.worker_id;
    const name = cleaned.Name;
    const hourlyHours = parseNumericField(cleaned['Hourly Hours']);
    const overtimeHours = parseNumericField(cleaned['Overtime Hours']);

    if (!name || String(name).trim() === '') {
      errors.push({ row: index, reason: 'Name is required' });
    }
    if (!employeeId || String(employeeId).trim() === '') {
      errors.push({ row: index, reason: 'Employee ID is required' });
    }
    if (hourlyHours < 0 || overtimeHours < 0) {
      errors.push({ row: index, reason: 'Hours cannot be negative' });
    }
    if (hourlyHours + overtimeHours <= 0 && parseNumericField(cleaned['Reimbursement Amount']) <= 0) {
      errors.push({ row: index, reason: 'Row must have hours or a reimbursement amount' });
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
    const hourlyRaw = parseNumericField(agg.hourly_hours);
    const overtimeRaw = parseNumericField(agg.overtime_hours);
    const doubletimeRaw = parseNumericField(agg.doubletime_hours);
    const ptoRaw = parseNumericField(agg.pto_hours);
    const hourlyHours = displayHourlyHours(agg);
    const overtimeHours = displayOvertimeHours(agg);
    const { baseReimbursement, reimbursement, shortPay, hasAdjustment } =
      resolveMoneyFields(agg);
    const rateRaw = agg.hourly_rate;
    const rateMissing = rateRaw == null || rateRaw === '' || !Number.isFinite(Number(rateRaw));
    const hourlyRate = rateMissing ? 0 : parseNumericField(rateRaw);
    const workerId = agg.worker_id != null ? String(agg.worker_id) : '';

    if (hourlyHours + overtimeHours <= 0 && reimbursement <= 0 && shortPay <= 0) {
      continue;
    }

    if (rateMissing && hourlyHours + overtimeHours > 0) {
      warnings.push({
        type: 'warning',
        message: `Missing Hourly Rate for ${agg.worker_name} — Total Amount uses $0.00 until workers.standard_rate is set`,
      });
    }

    const totalAmount = computeTotalAmount({
      hourlyHours: hourlyRaw,
      overtimeHours: overtimeRaw,
      doubletimeHours: doubletimeRaw,
      ptoHours: ptoRaw,
      hourlyRate,
      reimbursementAmount: reimbursement,
      shortPayAmount: shortPay,
    });

    rows.push({
      worker_id: workerId,
      Name: agg.worker_name,
      'Employee ID': workerId,
      'Total Amount': formatMoney(totalAmount),
      'Hourly Hours': formatHours(hourlyHours),
      'Hourly Rate': formatMoney(hourlyRate),
      'Overtime Hours': formatHours(overtimeHours),
      'Reimbursement Amount': formatMoney(reimbursement),
      'Short Pay Amount': formatMoney(shortPay),
      _employeeName: agg.worker_name,
      _workerDbId: agg.worker_db_id,
      _jobSiteId: null,
      _payPeriodId: payPeriodId,
      _hourlyHoursRaw: hourlyRaw,
      _overtimeHoursRaw: overtimeRaw,
      _doubletimeHours: doubletimeRaw,
      _ptoHours: ptoRaw,
      _rateMissing: rateMissing,
      _baseReimbursement: baseReimbursement,
      _hasAdjustment: hasAdjustment,
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
      return escapeCsvField(value);
    });
    lines.push(fields.join(','));
  }

  const csvString = lines.join('\n');
  return { csvString, filename };
}

/**
 * Delete all daily + aggregated time entries for a worker in the period
 * (all job sites and pay components — matches one export row).
 * If jobSiteId is provided, scopes to that site only (legacy).
 */
async function deletePayrollRow({ payPeriodId, workerDbId, jobSiteId }) {
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

  if (jobSiteId) {
    await query(
      `DELETE FROM daily_time_entries
       WHERE pay_period_id = $1
         AND worker_id = $2
         AND job_site_id = $3::uuid`,
      [payPeriodId, workerDbId, jobSiteId]
    );

    const result = await query(
      `DELETE FROM time_entries
       WHERE pay_period_id = $1
         AND worker_id = $2
         AND job_site_id = $3::uuid
       RETURNING id`,
      [payPeriodId, workerDbId, jobSiteId]
    );
    return result.rowCount;
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
  return parseNumericField(row['Hourly Hours']) + parseNumericField(row['Overtime Hours']);
}

module.exports = {
  EXPORT_CSV_HEADERS,
  AGGREGATION_SQL,
  OT_EARNINGS_MULTIPLIER,
  DT_EARNINGS_MULTIPLIER,
  SHORT_PAY_SOURCE_NOTE,
  formatDate,
  escapeCsvField,
  formatHours,
  formatMoney,
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
