require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { query, pool } = require('../db');

async function main() {
  const raw = fs.readFileSync(
    path.join(__dirname, '../db/migrations/019_local_payroll_parity.sql'),
    'utf8'
  );
  await query(raw);
  const cols = await query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'workers'
       AND column_name IN ('address', 'identifying_last4')`
  );
  console.log('workers columns:', cols.rows.map((r) => r.column_name).join(', ') || 'MISSING');
}

main()
  .then(() => pool.end())
  .catch((err) => {
    console.error(err.message);
    pool.end();
    process.exit(1);
  });
