/**
 * Reassign entries from 4-day Jul 27-31 period to Jul 26-Aug 8 biweekly,
 * then delete the empty bad period.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { pool } = require('../db');

const BAD_ID = '07c249d9-33c6-45c8-80b0-3aba1b12e097';
const GOOD_ID = 'bb5c3393-fefd-44e1-a9a5-d4a92bb2ef1e';

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const good = await client.query(
      `SELECT id, start_date::text, end_date::text, end_date::text AS pay_period_end_date
       FROM pay_periods WHERE id = $1 AND (end_date - start_date) = 13`,
      [GOOD_ID]
    );
    if (good.rows.length === 0) {
      throw new Error(`Target biweekly period ${GOOD_ID} not found`);
    }
    console.log('Target period:', good.rows[0]);

    const dte = await client.query(
      `UPDATE daily_time_entries
       SET pay_period_id = $1,
           pay_period_end_date = $2::date
       WHERE pay_period_id = $3
       RETURNING id, date_worked::text, hours_worked, pay_period_id`,
      [GOOD_ID, good.rows[0].end_date, BAD_ID]
    );
    console.log('Updated daily_time_entries:', dte.rowCount, dte.rows);

    const te = await client.query(
      `UPDATE time_entries
       SET pay_period_id = $1
       WHERE pay_period_id = $2
       RETURNING id, worker_id, pay_period_id`,
      [GOOD_ID, BAD_ID]
    );
    console.log('Updated time_entries:', te.rowCount, te.rows);

    const remaining = await client.query(
      `SELECT
         (SELECT COUNT(*)::int FROM daily_time_entries WHERE pay_period_id = $1) AS daily_entries,
         (SELECT COUNT(*)::int FROM time_entries WHERE pay_period_id = $1) AS time_entries`,
      [BAD_ID]
    );
    console.log('Bad period remaining attachments:', remaining.rows[0]);
    if (remaining.rows[0].daily_entries > 0 || remaining.rows[0].time_entries > 0) {
      throw new Error('Bad period still has entries; aborting delete');
    }

    const del = await client.query(
      `DELETE FROM pay_periods WHERE id = $1
       RETURNING id, start_date::text, end_date::text`,
      [BAD_ID]
    );
    console.log('Deleted bad period:', del.rows);

    await client.query('COMMIT');

    const verifyPp = await client.query(`
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE (end_date - start_date) <> 13)::int AS non13
      FROM pay_periods
    `);
    const verifyCat = await client.query(`
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE (end_date - start_date) <> 13)::int AS non13
      FROM paychex_pay_periods
    `);
    const current = await client.query(`
      SELECT id, start_date::text, end_date::text, status,
             (end_date - start_date) AS days
      FROM pay_periods
      WHERE status = 'OPEN'
        AND start_date <= CURRENT_DATE
        AND end_date >= CURRENT_DATE
      ORDER BY start_date DESC
      LIMIT 5
    `);
    console.log('pay_periods:', verifyPp.rows[0]);
    console.log('paychex_pay_periods:', verifyCat.rows[0]);
    console.log('OPEN covering today (newest first):', current.rows);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
