require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { pool } = require('../db');

async function main() {
  const badId = '07c249d9-33c6-45c8-80b0-3aba1b12e097';
  const entries = await pool.query(
    `SELECT id, date_worked::text, hours_worked, pay_code, worker_id, pay_period_id
     FROM daily_time_entries WHERE pay_period_id = $1`,
    [badId]
  );
  console.log('daily_time_entries on Jul 27-31 period:', JSON.stringify(entries.rows, null, 2));

  const te = await pool.query(
    `SELECT id, worker_id, pay_period_id, regular_hours, overtime_hours
     FROM time_entries WHERE pay_period_id = $1`,
    [badId]
  );
  console.log('time_entries on Jul 27-31 period:', JSON.stringify(te.rows, null, 2));

  const overlap = await pool.query(
    `SELECT id, start_date::text, end_date::text, status,
            (end_date - start_date) AS period_length_days
     FROM pay_periods
     WHERE start_date <= '2026-07-31'::date
       AND end_date >= '2026-07-27'::date
       AND (end_date - start_date) = 13
     ORDER BY start_date`
  );
  console.log('overlapping 14-day periods:', JSON.stringify(overlap.rows, null, 2));

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
