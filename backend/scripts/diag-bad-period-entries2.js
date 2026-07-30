require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { pool } = require('../db');

async function main() {
  const badId = '07c249d9-33c6-45c8-80b0-3aba1b12e097';

  const te = await pool.query(
    'SELECT id, worker_id, pay_period_id FROM time_entries WHERE pay_period_id = $1',
    [badId]
  );
  console.log('time_entries', JSON.stringify(te.rows, null, 2));

  const ov = await pool.query(
    `SELECT id, start_date::text, end_date::text, status,
            (end_date - start_date) AS days
     FROM pay_periods
     WHERE start_date <= $1::date
       AND end_date >= $2::date
       AND (end_date - start_date) = 13`,
    ['2026-07-31', '2026-07-27']
  );
  console.log('overlap14', JSON.stringify(ov.rows, null, 2));

  const empty = await pool.query(
    `SELECT id, start_date::text, end_date::text, (end_date - start_date) AS days
     FROM pay_periods
     WHERE (end_date - start_date) <> 13
       AND id NOT IN (
         SELECT DISTINCT pay_period_id FROM daily_time_entries WHERE pay_period_id IS NOT NULL
         UNION
         SELECT DISTINCT pay_period_id FROM time_entries WHERE pay_period_id IS NOT NULL
       )
     ORDER BY start_date DESC`
  );
  console.log('empty non-13 count', empty.rows.length);
  console.log(JSON.stringify(empty.rows, null, 2));

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
