const { query } = require('../db');

const OT_EARNINGS_MULTIPLIER = 1.5;
const EMPLOYER_LIABILITY_RATE = 0.08;

const COMPANY_EARNINGS_SQL = `
SELECT
  COALESCE(SUM(
    CASE
      WHEN te.paychex_component_id IN ('REGULAR', 'HOURLY', 'Hourly', 'Regular')
        THEN te.hours * COALESCE(wjsr.rate, w.standard_rate, 0)
      WHEN te.paychex_component_id IN ('OT', 'OVERTIME', 'Overtime')
        THEN te.hours * COALESCE(wjsr.rate, w.standard_rate, 0) * ${OT_EARNINGS_MULTIPLIER}
      WHEN te.paychex_component_id IN ('DT', 'DOUBLETIME', 'Doubletime')
        THEN te.hours * COALESCE(wjsr.rate, w.standard_rate, 0) * 2
      WHEN te.paychex_component_id IN ('PTO', 'Vacation', 'Sick')
        THEN te.hours * COALESCE(wjsr.rate, w.standard_rate, 0)
      ELSE 0
    END
  ), 0) AS total_earnings
FROM time_entries te
JOIN workers w ON te.worker_id = w.id
LEFT JOIN worker_job_site_rates wjsr
  ON wjsr.worker_id = w.id AND wjsr.job_site_id = te.job_site_id
WHERE te.pay_period_id = $1
  AND te.paychex_component_id NOT IN ('REIMBURSE', 'Reimbursement')
`;

const AGGREGATED_SUMMARY_SQL = `
SELECT
  w.employee_code                                                          AS "employeeId",
  w.first_name                                                             AS "firstName",
  w.last_name                                                              AS "lastName",
  COALESCE(SUM(CASE WHEN d.week_number = 1 AND d.pay_code IN ('REGULAR', 'HOURLY', 'Regular', 'Hourly') THEN d.hours_worked END), 0) AS "week1Regular",
  COALESCE(SUM(CASE WHEN d.week_number = 1 AND d.pay_code = 'OT' THEN d.hours_worked END), 0)                                               AS "week1Overtime",
  COALESCE(SUM(CASE WHEN d.week_number = 1 THEN d.hours_worked END), 0)        AS "week1Total",
  COALESCE(SUM(CASE WHEN d.week_number = 2 AND d.pay_code IN ('REGULAR', 'HOURLY', 'Regular', 'Hourly') THEN d.hours_worked END), 0) AS "week2Regular",
  COALESCE(SUM(CASE WHEN d.week_number = 2 AND d.pay_code = 'OT' THEN d.hours_worked END), 0)                                               AS "week2Overtime",
  COALESCE(SUM(CASE WHEN d.week_number = 2 THEN d.hours_worked END), 0)        AS "week2Total",
  COALESCE(SUM(CASE WHEN d.pay_code IN ('REGULAR', 'HOURLY', 'Regular', 'Hourly') THEN d.hours_worked END), 0)                               AS "totalRegular",
  COALESCE(SUM(CASE WHEN d.pay_code = 'OT' THEN d.hours_worked END), 0)                                                                    AS "totalOvertime",
  COALESCE(SUM(d.hours_worked), 0)                                               AS "totalHours",
  COALESCE(SUM(CASE WHEN d.component_name ILIKE '%truck%' THEN d.reimbursement_amount END), 0)                                                   AS "truckReimbursement",
  COALESCE(SUM(CASE WHEN d.component_name NOT ILIKE '%truck%' THEN d.reimbursement_amount END), 0)                                               AS "otherReimbursements",
  COALESCE(SUM(d.hours_worked * COALESCE(wjsr.rate, w.standard_rate, 0)), 0) + COALESCE(SUM(d.reimbursement_amount), 0)                                                      AS "total",
  MAX(COALESCE(wjsr.rate, w.standard_rate, 0))                                                                                             AS "standardRate"
FROM daily_time_entries d
JOIN workers w  ON d.worker_id    = w.id
LEFT JOIN worker_job_site_rates wjsr
  ON wjsr.worker_id = w.id AND wjsr.job_site_id = d.job_site_id
WHERE d.pay_period_id = $1
GROUP BY w.employee_code, w.first_name, w.last_name
ORDER BY w.last_name, w.first_name;
`;

const CSV_HEADERS = [
  'Employee ID',
  'First Name',
  'Last Name',
  'Week 1 Regular',
  'Week 1 Overtime',
  'Week 1 Total',
  'Week 2 Regular',
  'Week 2 Overtime',
  'Week 2 Total',
  'Total Regular',
  'Total Overtime',
  'Total Working Hours',
  'Truck Reimbursements',
  'Reimbursements',
  'Total',
];

const CSV_FIELD_MAP = [
  'employeeId',
  'firstName',
  'lastName',
  'week1Regular',
  'week1Overtime',
  'week1Total',
  'week2Regular',
  'week2Overtime',
  'week2Total',
  'totalRegular',
  'totalOvertime',
  'totalHours',
  'truckReimbursement',
  'otherReimbursements',
  'total',
];

function escapeCSV(value) {
  const str = value == null ? '' : String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

async function getAggregatedSummary(payPeriodId) {
  const result = await query(AGGREGATED_SUMMARY_SQL, [payPeriodId]);
  return result.rows;
}

async function getCompanyEarnings(payPeriodId) {
  const result = await query(COMPANY_EARNINGS_SQL, [payPeriodId]);
  const total = parseFloat(result.rows[0]?.total_earnings) || 0;
  return total;
}

async function getCompanyReimbursements(payPeriodId) {
  const [internalResult, paychexResult] = await Promise.all([
    query(
      `SELECT COALESCE(SUM(reimbursement_amount), 0)::float AS total
       FROM daily_time_entries
       WHERE pay_period_id = $1`,
      [payPeriodId]
    ),
    // Recurring Paychex reimbursements are modeled as per-pay-period amounts
    // for active workers (one check per period).
    query(
      `SELECT COALESCE(SUM(wrr.amount), 0)::float AS total
       FROM worker_recurring_reimbursements wrr
       JOIN workers w ON w.id = wrr.worker_id
       WHERE w.is_active = true
         AND wrr.recurring = true`
    ),
  ]);

  const internal = Number(internalResult.rows[0]?.total) || 0;
  const paychexRecurring = Number(paychexResult.rows[0]?.total) || 0;

  return {
    internal,
    paychexRecurring,
    total: internal + paychexRecurring,
  };
}

function generateCSV(rows) {
  const lines = [CSV_HEADERS.join(',')];
  for (const row of rows) {
    const values = CSV_FIELD_MAP.map((field) => escapeCSV(row[field]));
    lines.push(values.join(','));
  }
  return lines.join('\n');
}

module.exports = {
  getAggregatedSummary,
  getCompanyEarnings,
  getCompanyReimbursements,
  generateCSV,
  AGGREGATED_SUMMARY_SQL,
  COMPANY_EARNINGS_SQL,
  CSV_HEADERS,
  CSV_FIELD_MAP,
  OT_EARNINGS_MULTIPLIER,
  EMPLOYER_LIABILITY_RATE,
};
