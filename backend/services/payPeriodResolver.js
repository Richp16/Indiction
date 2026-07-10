const { query } = require('../db');

function normalizeDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return value.toISOString().split('T')[0];
  }
  return String(value).split('T')[0];
}

function determineWeekNumber(entryDate, payPeriod) {
  const date = normalizeDate(entryDate);
  const week1Start = normalizeDate(payPeriod.week1_start);
  const week1End = normalizeDate(payPeriod.week1_end);
  const week2Start = normalizeDate(payPeriod.week2_start);
  const week2End = normalizeDate(payPeriod.week2_end);

  if (date >= week1Start && date <= week1End) {
    return 1;
  }
  if (date >= week2Start && date <= week2End) {
    return 2;
  }
  return null;
}

async function resolvePayPeriodForDate(dateWorked, payPeriodId = null) {
  const date = normalizeDate(dateWorked);
  if (!date) {
    const error = new Error('dateWorked is required');
    error.statusCode = 400;
    throw error;
  }

  if (payPeriodId) {
    const byId = await query(
      `SELECT
         id,
         paychex_period_id,
         start_date::text AS start_date,
         end_date::text AS end_date,
         end_date::text AS pay_period_end_date,
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
    if (byId.rows.length === 0) {
      const error = new Error('Pay period not found');
      error.statusCode = 400;
      throw error;
    }
    const period = byId.rows[0];
    if (date < period.start_date || date > period.end_date) {
      const error = new Error('Entry date does not fall within the selected pay period');
      error.statusCode = 400;
      throw error;
    }
    return period;
  }

  const result = await query(
    `SELECT
       id,
       paychex_period_id,
       start_date::text AS start_date,
       end_date::text AS end_date,
       end_date::text AS pay_period_end_date,
       submit_by_date::text AS submit_by_date,
       pay_date::text AS pay_date,
       status,
       week1_start::text AS week1_start,
       week1_end::text AS week1_end,
       week2_start::text AS week2_start,
       week2_end::text AS week2_end
     FROM pay_periods
     WHERE $1::date BETWEEN start_date AND end_date
     ORDER BY start_date DESC
     LIMIT 1`,
    [date]
  );

  if (result.rows.length === 0) {
    const error = new Error('No pay period found for the entry date');
    error.statusCode = 400;
    throw error;
  }

  return result.rows[0];
}

module.exports = {
  normalizeDate,
  determineWeekNumber,
  resolvePayPeriodForDate,
};
