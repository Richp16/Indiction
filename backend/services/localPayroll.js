/**
 * Provider-neutral local payroll review and export (Non-Paychex mode).
 * Uses the same time_entries aggregation as Summary / Job Costing.
 */
const { query } = require('../db');
const {
  mapPaychexComponentToPayCode,
  getPayCodeMeta,
  PAY_CODE_META,
} = require('../config/payCodeMapping');
const { mapPeriodOption } = require('./payrollPayPeriods');

const OT_MULTIPLIER = 1.5;
const DT_MULTIPLIER = 2;

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function rateMultiplier(payCode) {
  const meta = getPayCodeMeta(payCode);
  if (meta) return meta.multiplier;
  if (payCode === 'OT') return OT_MULTIPLIER;
  if (payCode === 'DT') return DT_MULTIPLIER;
  return 1;
}

async function loadPayPeriod(payPeriodId) {
  try {
    const result = await query(
      `SELECT
         id,
         paychex_period_id,
         start_date::text AS start_date,
         end_date::text AS end_date,
         submit_by_date::text AS submit_by_date,
         pay_date::text AS pay_date,
         status,
         week1_start::text AS week1_start,
         week1_end::text AS week1_end,
         week2_start::text AS week2_start,
         week2_end::text AS week2_end,
         exported_at,
         finalized_at
       FROM pay_periods
       WHERE id = $1`,
      [payPeriodId]
    );
    return result.rows[0] || null;
  } catch (error) {
    if (!String(error.message || '').includes('exported_at')) throw error;
    const result = await query(
      `SELECT
         id,
         paychex_period_id,
         start_date::text AS start_date,
         end_date::text AS end_date,
         submit_by_date::text AS submit_by_date,
         pay_date::text AS pay_date,
         status,
         week1_start::text AS week1_start,
         week1_end::text AS week1_end,
         week2_start::text AS week2_start,
         week2_end::text AS week2_end
       FROM pay_periods
       WHERE id = $1`,
      [payPeriodId]
    );
    const row = result.rows[0];
    if (!row) return null;
    return { ...row, exported_at: null, finalized_at: null };
  }
}

async function buildLocalPayrollReview(payPeriodId) {
  const period = await loadPayPeriod(payPeriodId);
  if (!period) {
    const error = new Error('Pay period not found');
    error.statusCode = 404;
    throw error;
  }

  const entries = await query(
    `SELECT
       te.id,
       te.worker_id,
       w.employee_code,
       w.first_name,
       w.last_name,
       w.is_active,
       js.job_code,
       js.name AS job_site_name,
       te.job_site_id,
       te.paychex_component_id,
       te.component_name,
       te.hours,
       te.reimbursement_amount,
       te.component_rate,
       COALESCE(wjsr.rate, w.standard_rate, te.component_rate, 0) AS effective_rate
     FROM time_entries te
     JOIN workers w ON w.id = te.worker_id
     LEFT JOIN job_sites js ON js.id = te.job_site_id
     LEFT JOIN worker_job_site_rates wjsr
       ON wjsr.worker_id = w.id AND wjsr.job_site_id = te.job_site_id
     WHERE te.pay_period_id = $1
     ORDER BY w.last_name, w.first_name, js.job_code, te.paychex_component_id`,
    [payPeriodId]
  );

  const issues = [];
  const rows = [];
  const workerTotals = new Map();

  let companyHours = 0;
  let companyGross = 0;
  let companyReimbursements = 0;

  for (const row of entries.rows) {
    const payCode = mapPaychexComponentToPayCode(
      String(row.paychex_component_id || '').toUpperCase()
    );
    const meta = getPayCodeMeta(payCode) || PAY_CODE_META.REGULAR;
    const hours = Number(row.hours) || 0;
    const reimbursement = Number(row.reimbursement_amount) || 0;
    const rate = Number(row.effective_rate) || 0;
    const rateMissing = rate <= 0 && meta.contributesToGross && hours > 0;

    if (rateMissing) {
      issues.push({
        severity: 'error',
        workerId: row.worker_id,
        message: `Missing rate for ${row.last_name}, ${row.first_name} (${payCode})`,
      });
    }
    if (!row.employee_code) {
      issues.push({
        severity: 'warning',
        workerId: row.worker_id,
        message: `Worker ${row.last_name}, ${row.first_name} has no employee_code`,
      });
    }
    if (!getPayCodeMeta(payCode) && payCode !== String(row.paychex_component_id || '').toUpperCase()) {
      issues.push({
        severity: 'warning',
        workerId: row.worker_id,
        message: `Unknown pay component ${row.paychex_component_id}`,
      });
    }

    const amount = meta.usesAmount
      ? roundMoney(reimbursement)
      : roundMoney(hours * rate * rateMultiplier(payCode));
    const totalGross = meta.contributesToGross ? amount : 0;

    if (meta.contributesToWorkedHours) companyHours += hours;
    companyGross += totalGross;
    companyReimbursements += reimbursement;

    const key = row.worker_id;
    if (!workerTotals.has(key)) {
      workerTotals.set(key, {
        workerId: row.worker_id,
        employeeCode: row.employee_code,
        firstName: row.first_name,
        lastName: row.last_name,
        isActive: row.is_active,
        hours: 0,
        gross: 0,
        reimbursements: 0,
      });
    }
    const wt = workerTotals.get(key);
    if (meta.contributesToWorkedHours) wt.hours += hours;
    wt.gross += totalGross;
    wt.reimbursements += reimbursement;

    rows.push({
      employeeCode: row.employee_code || '',
      firstName: row.first_name,
      lastName: row.last_name,
      workerId: row.worker_id,
      isActive: row.is_active,
      periodStart: period.start_date,
      periodEnd: period.end_date,
      payDate: period.pay_date,
      jobCode: row.job_code || '',
      jobSiteName: row.job_site_name || '',
      payCode,
      payCodeLabel: meta.displayName,
      hours,
      rate: meta.usesHours ? rate : null,
      amount: totalGross,
      reimbursementAmount: reimbursement,
      totalGross: roundMoney(totalGross + reimbursement),
      rateMissing,
    });
  }

  const periodOption = mapPeriodOption(period);

  return {
    payPeriod: {
      ...periodOption,
      status: period.status,
      exportedAt: period.exported_at || null,
      finalizedAt: period.finalized_at || null,
    },
    rows,
    workerTotals: [...workerTotals.values()].map((w) => ({
      ...w,
      hours: roundMoney(w.hours),
      gross: roundMoney(w.gross),
      reimbursements: roundMoney(w.reimbursements),
      total: roundMoney(w.gross + w.reimbursements),
    })),
    companyTotals: {
      hours: roundMoney(companyHours),
      gross: roundMoney(companyGross),
      reimbursements: roundMoney(companyReimbursements),
      total: roundMoney(companyGross + companyReimbursements),
    },
    issues,
    blockingIssueCount: issues.filter((i) => i.severity === 'error').length,
  };
}

function escapeCsv(value) {
  const str = value == null ? '' : String(value);
  if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function buildLocalPayrollCsv(review) {
  const headers = [
    'employee_code',
    'first_name',
    'last_name',
    'period_start',
    'period_end',
    'pay_date',
    'job_code',
    'pay_code',
    'hours',
    'rate',
    'amount',
    'reimbursement_amount',
    'total_gross',
  ];
  const lines = [headers.join(',')];
  for (const row of review.rows) {
    lines.push(
      [
        escapeCsv(row.employeeCode),
        escapeCsv(row.firstName),
        escapeCsv(row.lastName),
        escapeCsv(row.periodStart),
        escapeCsv(row.periodEnd),
        escapeCsv(row.payDate),
        escapeCsv(row.jobCode),
        escapeCsv(row.payCode),
        escapeCsv(row.hours),
        escapeCsv(row.rate),
        escapeCsv(row.amount),
        escapeCsv(row.reimbursementAmount),
        escapeCsv(row.totalGross),
      ].join(',')
    );
  }
  lines.push('');
  lines.push(
    [
      'TOTALS',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      escapeCsv(review.companyTotals.hours),
      '',
      escapeCsv(review.companyTotals.gross),
      escapeCsv(review.companyTotals.reimbursements),
      escapeCsv(review.companyTotals.total),
    ].join(',')
  );
  return `${lines.join('\n')}\n`;
}

async function markPayPeriodExported(payPeriodId) {
  const result = await query(
    `UPDATE pay_periods
     SET exported_at = now(),
         status = CASE WHEN status = 'OPEN' THEN 'EXPORTED' ELSE status END
     WHERE id = $1
     RETURNING id, status, exported_at, finalized_at`,
    [payPeriodId]
  );
  if (!result.rows.length) {
    const error = new Error('Pay period not found');
    error.statusCode = 404;
    throw error;
  }
  return result.rows[0];
}

async function finalizePayPeriod(payPeriodId) {
  const result = await query(
    `UPDATE pay_periods
     SET status = 'CLOSED',
         finalized_at = now(),
         exported_at = COALESCE(exported_at, now())
     WHERE id = $1
     RETURNING id, status, exported_at, finalized_at`,
    [payPeriodId]
  );
  if (!result.rows.length) {
    const error = new Error('Pay period not found');
    error.statusCode = 404;
    throw error;
  }
  return result.rows[0];
}

async function reopenPayPeriod(payPeriodId) {
  const result = await query(
    `UPDATE pay_periods
     SET status = 'OPEN',
         finalized_at = NULL
     WHERE id = $1
     RETURNING id, status, exported_at, finalized_at`,
    [payPeriodId]
  );
  if (!result.rows.length) {
    const error = new Error('Pay period not found');
    error.statusCode = 404;
    throw error;
  }
  return result.rows[0];
}

module.exports = {
  buildLocalPayrollReview,
  buildLocalPayrollCsv,
  markPayPeriodExported,
  finalizePayPeriod,
  reopenPayPeriod,
  loadPayPeriod,
};
