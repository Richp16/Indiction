require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { pool } = require('../db');

async function main() {
  const r1 = await pool.query(`
    SELECT id, paychex_period_id, start_date::text, end_date::text, status,
           (end_date - start_date) AS period_length_days
    FROM pay_periods
    ORDER BY start_date DESC
  `);
  console.log('=== pay_periods ===');
  console.log('total:', r1.rows.length);
  console.log('non-13:', r1.rows.filter((r) => Number(r.period_length_days) !== 13).length);
  console.log(JSON.stringify(r1.rows, null, 2));

  const r2 = await pool.query(`
    SELECT pay_period_id, start_date::text, end_date::text, status,
           (end_date - start_date) AS period_length_days
    FROM paychex_pay_periods
    ORDER BY start_date DESC
  `);
  console.log('=== paychex_pay_periods ===');
  console.log('total:', r2.rows.length);
  console.log('non-13:', r2.rows.filter((r) => Number(r.period_length_days) !== 13).length);
  console.log(JSON.stringify(r2.rows, null, 2));

  const r3 = await pool.query(`
    SELECT pp.id, pp.start_date::text, pp.end_date::text,
           (pp.end_date - pp.start_date) AS period_length_days,
           (SELECT COUNT(*)::int FROM daily_time_entries WHERE pay_period_id = pp.id) AS daily_entries,
           (SELECT COUNT(*)::int FROM time_entries WHERE pay_period_id = pp.id) AS time_entries
    FROM pay_periods pp
    WHERE (pp.end_date - pp.start_date) <> 13
    ORDER BY pp.start_date DESC
  `);
  console.log('=== non-biweekly with entry counts ===');
  console.log(JSON.stringify(r3.rows, null, 2));

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
