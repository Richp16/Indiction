require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { query } = require('../db');

async function runMigration(filename) {
  const raw = fs.readFileSync(
    path.join(__dirname, '../db/migrations', filename),
    'utf8'
  );
  const upSql = raw.split('-- Down migration:')[0];
  console.log(`Running ${filename}...`);
  await query(upSql);
  console.log(`Completed ${filename}`);
}

async function main() {
  const run007 = process.argv.includes('--only-007');
  await runMigration('007_daily_time_entries.sql');
  if (!run007) {
    await runMigration('008_time_entries_aggregate.sql');
  }

  const tables = await query(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name IN ('daily_time_entries', 'time_entries')`
  );
  console.log('Tables present:', tables.rows.map((r) => r.table_name));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
