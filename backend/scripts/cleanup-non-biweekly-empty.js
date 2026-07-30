/**
 * Cleanup: delete empty non-biweekly pay_periods + all non-biweekly paychex_pay_periods.
 * Does NOT touch non-biweekly pay_periods that still have entries.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { pool } = require('../db');

async function main() {
  const del1 = await pool.query(`
    DELETE FROM pay_periods
    WHERE (end_date - start_date) <> 13
      AND id NOT IN (
        SELECT DISTINCT pay_period_id FROM daily_time_entries WHERE pay_period_id IS NOT NULL
        UNION
        SELECT DISTINCT pay_period_id FROM time_entries WHERE pay_period_id IS NOT NULL
      )
    RETURNING id, start_date::text, end_date::text, (end_date - start_date) AS days
  `);
  console.log('Deleted empty non-biweekly pay_periods:', del1.rowCount);
  console.log(JSON.stringify(del1.rows, null, 2));

  const del2 = await pool.query(`
    DELETE FROM paychex_pay_periods
    WHERE (end_date - start_date) <> 13
    RETURNING pay_period_id, start_date::text, end_date::text, (end_date - start_date) AS days
  `);
  console.log('Deleted non-biweekly paychex_pay_periods:', del2.rowCount);

  const leftPp = await pool.query(`
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE (end_date - start_date) <> 13)::int AS non13
    FROM pay_periods
  `);
  const leftCat = await pool.query(`
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE (end_date - start_date) <> 13)::int AS non13
    FROM paychex_pay_periods
  `);
  console.log('pay_periods remaining:', leftPp.rows[0]);
  console.log('paychex_pay_periods remaining:', leftCat.rows[0]);

  const remain = await pool.query(`
    SELECT id, start_date::text, end_date::text, (end_date - start_date) AS days,
           (SELECT COUNT(*)::int FROM daily_time_entries d WHERE d.pay_period_id = pp.id) AS daily_entries
    FROM pay_periods pp
    WHERE (end_date - start_date) <> 13
  `);
  console.log('Remaining non-biweekly pay_periods (need reassignment):', JSON.stringify(remain.rows, null, 2));

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
