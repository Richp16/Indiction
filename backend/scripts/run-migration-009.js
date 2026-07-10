require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { query, pool } = require('../db');

async function main() {
  const raw = fs.readFileSync(
    path.join(__dirname, '../db/migrations/009_worker_labor_classification.sql'),
    'utf8'
  );
  const upSql = raw.split('-- Down migration:')[0];
  await query(upSql);

  const columnCheck = await query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_name = 'workers'
       AND column_name = 'labor_classification_id'`
  );
  console.log('workers.labor_classification_id:', columnCheck.rows.length > 0 ? 'OK' : 'MISSING');
}

main()
  .then(() => pool.end())
  .catch((err) => {
    console.error(err.message);
    pool.end();
    process.exit(1);
  });
