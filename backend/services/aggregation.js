const { query } = require('../db');

const OT_EARNINGS_MULTIPLIER = 1.5;
const EMPLOYER_LIABILITY_RATE = 0.08;

const COMPANY_EARNINGS_SQL = `
SELECT
  COALESCE(SUM(
    CASE
      WHEN te.paychex_component_id IN ('REGULAR', 'HOURLY', 'Hourly', 'Regular')
        THEN te.hours * COALESCE(w.standard_rate, 0)
      WHEN te.paychex_component_id IN ('OT', 'OVERTIME', 'Overtime')
        THEN te.hours * COALESCE(w.standard_rate, 0) * ${OT_EARNINGS_MULTIPLIER}
      WHEN te.paychex_component_id IN ('PTO', 'Vacation', 'Sick')
        THEN te.hours * COALESCE(w.standard_rate, 0)
      ELSE 0
    END
  ), 0) AS total_earnings
FROM time_entries te
JOIN workers w ON te.worker_id = w.id
WHERE te.pay_period_id = $1
  AND te.paychex_component_id NOT IN ('REIMBURSE', 'Reimbursement')
`;

const AGGREGATED_SUMMARY_SQL = `
SELECT
  w.employee_code                                                          AS "employeeId",
  w.first_name                                                             AS "firstName",
  w.last_name                                                              AS "lastName",
  js.name                                                                  AS "jobSite",
  COALESCE(SUM(CASE WHEN te.week_number = 1 AND te.paychex_component_id = 'REGULAR' THEN te.hours END), 0)                                        AS "week1Regular",
  COALESCE(SUM(CASE WHEN te.week_number = 1 AND te.paychex_component_id = 'OT' THEN te.hours END), 0)                                               AS "week1Overtime",
  COALESCE(SUM(CASE WHEN te.week_number = 1 THEN te.hours END), 0)        AS "week1Total",
  COALESCE(SUM(CASE WHEN te.week_number = 2 AND te.paychex_component_id = 'REGULAR' THEN te.hours END), 0)                                        AS "week2Regular",
  COALESCE(SUM(CASE WHEN te.week_number = 2 AND te.paychex_component_id = 'OT' THEN te.hours END), 0)                                               AS "week2Overtime",
  COALESCE(SUM(CASE WHEN te.week_number = 2 THEN te.hours END), 0)        AS "week2Total",
  COALESCE(SUM(CASE WHEN te.paychex_component_id = 'REGULAR' THEN te.hours END), 0)                                                               AS "totalRegular",
  COALESCE(SUM(CASE WHEN te.paychex_component_id = 'OT' THEN te.hours END), 0)                                                                    AS "totalOvertime",
  COALESCE(SUM(te.hours), 0)                                               AS "totalHours",
  COALESCE(SUM(CASE WHEN te.component_name ILIKE '%truck%' THEN te.reimbursement_amount END), 0)                                                   AS "truckReimbursement",
  COALESCE(SUM(CASE WHEN te.component_name NOT ILIKE '%truck%' THEN te.reimbursement_amount END), 0)                                               AS "otherReimbursements",
  COALESCE(SUM(te.hours * COALESCE(w.standard_rate, 0)), 0) + COALESCE(SUM(te.reimbursement_amount), 0)                                                      AS "total",
  MAX(w.standard_rate)                                                                                                                             AS "standardRate"
FROM time_entries te
JOIN workers w  ON te.worker_id    = w.id
JOIN job_sites js ON te.job_site_id = js.id
WHERE te.pay_period_id = $1
GROUP BY w.employee_code, w.first_name, w.last_name, js.name
ORDER BY w.last_name, w.first_name, js.name;
`;

const CSV_HEADERS = [
  'Employee ID',
  'First Name',
  'Last Name',
  'Job Site',
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
  'jobSite',
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
  generateCSV,
  OT_EARNINGS_MULTIPLIER,
  EMPLOYER_LIABILITY_RATE,
};
