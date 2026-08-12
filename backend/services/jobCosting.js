/**
 * Job Costing: per-worker, per-component rows for one job site + pay period.
 * Row shape mirrors Paychex SPI component breakdown (Hourly / Overtime /
 * Reimbursement) but includes worker name and is scoped to a job site.
 */

const { query } = require('../db');
const {
  getCompanyEarnings,
  getCompanyReimbursements,
  EMPLOYER_LIABILITY_RATE,
} = require('./aggregation');
const {
  PAY_COMPONENT,
  displayHourlyHours,
  displayOvertimeHours,
  formatPaychexNumber,
} = require('./paychexExport');

const EFFECTIVE_RATE_SQL = 'COALESCE(wjsr.rate, w.standard_rate, 0)';

const HOURLY_BY_RATE_FOR_SITE_SQL = `
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
  AND te.job_site_id = $2
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

const WORKER_EXTRAS_FOR_SITE_SQL = `
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
  COALESCE(SUM(te.reimbursement_amount), 0) AS base_reimbursement_amount
FROM time_entries te
JOIN workers w ON te.worker_id = w.id
WHERE te.pay_period_id = $1
  AND te.job_site_id = $2
GROUP BY
  w.id,
  w.first_name,
  w.last_name,
  w.employee_code
ORDER BY
  w.last_name,
  w.first_name
`;

function parseNumericField(value) {
  if (value == null || value === '') return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function blank() {
  return '';
}

/**
 * Build SPI-style component rows for one job site + pay period.
 */
async function generateJobCostingRows(payPeriodId, jobSiteId) {
  const [periodResult, siteResult] = await Promise.all([
    query(
      `SELECT id, start_date::text AS start_date, end_date::text AS end_date
       FROM pay_periods
       WHERE id = $1`,
      [payPeriodId]
    ),
    query(
      `SELECT id, name, job_code
       FROM job_sites
       WHERE id = $1`,
      [jobSiteId]
    ),
  ]);

  if (periodResult.rows.length === 0) {
    return { notFound: 'payPeriod', rows: [], jobSite: null, payPeriod: null };
  }
  if (siteResult.rows.length === 0) {
    return { notFound: 'jobSite', rows: [], jobSite: null, payPeriod: null };
  }

  const payPeriod = periodResult.rows[0];
  const jobSite = siteResult.rows[0];

  const [hourlyResult, extrasResult] = await Promise.all([
    query(HOURLY_BY_RATE_FOR_SITE_SQL, [payPeriodId, jobSiteId]),
    query(WORKER_EXTRAS_FOR_SITE_SQL, [payPeriodId, jobSiteId]),
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

  for (const worker of workerOrder) {
    const key = worker.id;
    const hourlyGroups = hourlyByWorker.get(key) || [];
    const extras = extrasByWorker.get(key) || {};
    const overtimeHours = displayOvertimeHours(extras);
    const reimbursement = parseNumericField(extras.base_reimbursement_amount);

    const hasHourly = hourlyGroups.some((g) => displayHourlyHours(g) > 0);
    const hasOt = overtimeHours > 0;
    const hasReimb = reimbursement > 0;
    if (!hasHourly && !hasOt && !hasReimb) continue;

    for (const group of hourlyGroups) {
      const hours = displayHourlyHours(group);
      if (hours <= 0) continue;

      const rateRaw = group.hourly_rate;
      const rateMissing =
        rateRaw == null || rateRaw === '' || !Number.isFinite(Number(rateRaw));
      const hourlyRate = rateMissing ? 0 : parseNumericField(rateRaw);

      rows.push({
        worker: worker.worker_name,
        workerId: worker.worker_id,
        workerDbId: worker.worker_db_id,
        payComponent: PAY_COMPONENT.HOURLY,
        payRate: rateMissing ? null : hourlyRate,
        payRateDisplay: rateMissing ? blank() : formatPaychexNumber(hourlyRate),
        hoursWorked: hours,
        hoursDisplay: formatPaychexNumber(hours),
        amount: null,
        amountDisplay: blank(),
      });
    }

    if (hasOt) {
      rows.push({
        worker: worker.worker_name,
        workerId: worker.worker_id,
        workerDbId: worker.worker_db_id,
        payComponent: PAY_COMPONENT.OVERTIME,
        payRate: null,
        payRateDisplay: blank(),
        hoursWorked: overtimeHours,
        hoursDisplay: formatPaychexNumber(overtimeHours),
        amount: null,
        amountDisplay: blank(),
      });
    }

    if (hasReimb) {
      rows.push({
        worker: worker.worker_name,
        workerId: worker.worker_id,
        workerDbId: worker.worker_db_id,
        payComponent: PAY_COMPONENT.REIMBURSEMENT,
        payRate: null,
        payRateDisplay: blank(),
        hoursWorked: 0,
        hoursDisplay: blank(),
        amount: reimbursement,
        amountDisplay: formatPaychexNumber(reimbursement),
      });
    }
  }

  return { notFound: null, rows, jobSite, payPeriod };
}

/**
 * Summary metrics matching SummaryPage /api/summary/analysis definitions,
 * scoped to one job site + pay period.
 *
 * Paychex recurring reimbursements are company-wide (not site-attributable),
 * so they are 0 when scoped to a job site — same metric keys, site-filtered data.
 */
async function getJobCostingSummary(payPeriodId, jobSiteId) {
  const [earnings, reimbursements] = await Promise.all([
    getCompanyEarnings(payPeriodId, { jobSiteId }),
    getCompanyReimbursements(payPeriodId, { jobSiteId }),
  ]);

  const totalEarnings = earnings.total;
  const employerLiability = totalEarnings * EMPLOYER_LIABILITY_RATE;

  return {
    totalEarnings,
    regularEarnings: earnings.regular,
    overtimeEarnings: earnings.overtimeTotal,
    totalReimbursements: reimbursements.total,
    internalReimbursements: reimbursements.internal,
    paychexRecurringReimbursements: reimbursements.paychexRecurring,
    employerLiability,
    cashRequirements: totalEarnings + reimbursements.total + employerLiability,
  };
}

module.exports = {
  generateJobCostingRows,
  getJobCostingSummary,
  HOURLY_BY_RATE_FOR_SITE_SQL,
  WORKER_EXTRAS_FOR_SITE_SQL,
};
