require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { query } = require('../db');

async function main() {
  const raw = fs.readFileSync(
    path.join(__dirname, '../db/migrations/006_certified_payroll_paychex_checks.sql'),
    'utf8'
  );
  const upSql = raw.split('-- Down migration:')[0];
  await query(upSql);

  const columnCheck = await query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_name = 'job_sites'
       AND column_name = 'wage_determination_no'`
  );
  console.log('wage_determination_no column:', columnCheck.rows);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
