require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { query, pool } = require('../db');

async function main() {
  const raw = fs.readFileSync(
    path.join(__dirname, '../db/migrations/013_worker_recurring_reimbursements.sql'),
    'utf8'
  );
  const upSql = raw.split('-- Down migration:')[0];
  await query(upSql);

  const tableCheck = await query(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name = 'worker_recurring_reimbursements'`
  );
  console.log(
    'worker_recurring_reimbursements:',
    tableCheck.rows.length > 0 ? 'OK' : 'MISSING'
  );
}

main()
  .then(() => pool.end())
  .catch((err) => {
    console.error(err.message);
    pool.end();
    process.exit(1);
  });
