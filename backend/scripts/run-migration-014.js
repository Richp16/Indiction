require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { query, pool } = require('../db');

async function main() {
  const raw = fs.readFileSync(
    path.join(__dirname, '../db/migrations/014_job_site_start_date.sql'),
    'utf8'
  );
  const upSql = raw.split('-- Down migration:')[0];
  await query(upSql);

  const colCheck = await query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'job_sites'
       AND column_name = 'start_date'`
  );
  console.log('job_sites.start_date:', colCheck.rows.length > 0 ? 'OK' : 'MISSING');
}

main()
  .then(() => pool.end())
  .catch((err) => {
    console.error(err.message);
    pool.end();
    process.exit(1);
  });
