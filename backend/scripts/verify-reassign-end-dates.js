require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { pool } = require('../db');

(async () => {
  const te = await pool.query(
    `SELECT id, pay_period_id, pay_period_end_date::text
     FROM time_entries WHERE id = $1`,
    ['a3ac08a1-3ebe-4012-9072-ef327a821e7f']
  );
  const dte = await pool.query(
    `SELECT id, pay_period_id, pay_period_end_date::text
     FROM daily_time_entries WHERE id = $1`,
    ['289b8ca8-670c-4f9d-ba0c-0d7830a3a061']
  );
  console.log('time_entries', te.rows);
  console.log('daily_time_entries', dte.rows);

  if (te.rows[0] && te.rows[0].pay_period_end_date !== '2026-08-08') {
    const u = await pool.query(
      `UPDATE time_entries SET pay_period_end_date = $1::date WHERE id = $2
       RETURNING id, pay_period_end_date::text`,
      ['2026-08-08', te.rows[0].id]
    );
    console.log('fixed time_entries end date', u.rows);
  }

  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
