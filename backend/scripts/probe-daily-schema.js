require('dotenv').config();
const { query, pool } = require('../db');

async function main() {
  const r = await query(
    `SELECT column_name, data_type
     FROM information_schema.columns
     WHERE table_name = 'daily_time_entries'
     ORDER BY ordinal_position`
  );
  console.log('daily_time_entries:', JSON.stringify(r.rows, null, 2));

  const te = await query(
    `SELECT column_name, data_type
     FROM information_schema.columns
     WHERE table_name = 'time_entries'
     ORDER BY ordinal_position`
  );
  console.log('time_entries:', JSON.stringify(te.rows, null, 2));
}

main()
  .then(() => pool.end())
  .catch((e) => {
    console.error(e);
    pool.end();
    process.exit(1);
  });
