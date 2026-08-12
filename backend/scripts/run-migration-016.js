require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { query, pool } = require('../db');

async function main() {
  const raw = fs.readFileSync(
    path.join(__dirname, '../db/migrations/016_global_edit_lock.sql'),
    'utf8'
  );
  const upSql = raw.split('-- Down migration:')[0];
  await query(upSql);

  const check = await query(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name IN ('active_edit_lock', 'edit_locks')
     ORDER BY table_name`
  );
  const names = check.rows.map((r) => r.table_name);
  console.log('tables:', names.join(', ') || '(none)');
  console.log(
    'active_edit_lock:',
    names.includes('active_edit_lock') ? 'OK' : 'MISSING'
  );
  console.log('edit_locks gone:', !names.includes('edit_locks') ? 'OK' : 'STILL PRESENT');
}

main()
  .then(() => pool.end())
  .catch((err) => {
    console.error(err.message);
    pool.end();
    process.exit(1);
  });
