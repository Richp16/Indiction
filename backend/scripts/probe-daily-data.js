require('dotenv').config();
const { query, pool } = require('../db');

async function main() {
  const count = await query('SELECT COUNT(*)::int AS n FROM daily_time_entries');
  console.log('daily_time_entries count:', count.rows[0].n);

  const sample = await query('SELECT * FROM daily_time_entries LIMIT 3');
  console.log('sample:', JSON.stringify(sample.rows, null, 2));

  const workers = await query(
    `SELECT id, paychex_worker_id, employee_code FROM workers LIMIT 3`
  );
  console.log('workers sample:', JSON.stringify(workers.rows, null, 2));
}

main()
  .then(() => pool.end())
  .catch((e) => {
    console.error(e);
    pool.end();
    process.exit(1);
  });
