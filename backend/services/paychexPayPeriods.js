const { query } = require('../db');
const { listPayrollPayPeriods, PAYROLL_PERIODS_LIMIT } = require('./payrollPayPeriods');
const { enrichPeriodsWithCatalogIds } = require('./paychexPayPeriodReconcile');
const { companyId } = require('../config/paychexApi');

const CLOSED_PERIODS_LIMIT = 20;
const HISTORY_MONTHS = 6;

/**
 * Certified Payroll pay periods — same derivation as /api/payroll/pay-periods
 * (pay_periods rows with daily_time_entries / time_entries, newest first),
 * enriched with paychexPayPeriodId from paychex_pay_periods when dates match.
 */
async function fetchPaychexPayPeriods() {
  const distinctResult = await query(
    `SELECT COUNT(DISTINCT pay_period_id)::int AS period_count
     FROM daily_time_entries
     WHERE pay_period_id IS NOT NULL`
  );
  const rawDistinctPeriodCount = distinctResult.rows[0]?.period_count ?? 0;

  const limit = Math.min(CLOSED_PERIODS_LIMIT, PAYROLL_PERIODS_LIMIT);
  const periods = await listPayrollPayPeriods({ limit });
  const enriched = await enrichPeriodsWithCatalogIds(periods, companyId());

  console.log('[PayPeriods] Certified payroll periods (shared payroll derivation):', {
    rawDistinctPeriodCountInDailyTimeEntries: rawDistinctPeriodCount,
    returnedCount: enriched.length,
    limit,
    linkedCount: enriched.filter((period) => period.paychexPayPeriodId).length,
    labels: enriched.map((period) => period.label),
  });

  return enriched;
}

module.exports = {
  CLOSED_PERIODS_LIMIT,
  HISTORY_MONTHS,
  fetchPaychexPayPeriods,
};
