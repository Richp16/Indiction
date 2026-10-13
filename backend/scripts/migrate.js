require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { pool } = require('../db');
const { describeDatabaseTarget } = require('../db/databaseSsl');
const { runMigrations } = require('../db/migrate');

function printReport(report) {
  console.log(`Migration mode: ${report.mode}`);
  console.log(`Database: ${describeDatabaseTarget(process.env.DATABASE_URL)}`);
  if (report.applied.length === 0) {
    console.log('Applied: none');
  } else {
    console.log('Applied:');
    for (const name of report.applied) console.log(`  ${name}`);
  }
  console.log(`Skipped (already recorded): ${report.skipped.length}`);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Copy backend/.env.example to backend/.env and edit it.');
    process.exit(1);
  }

  const baseline = process.argv.includes('--baseline');
  const report = await runMigrations(pool, { baseline });
  printReport(report);
  if (report.mode === 'fresh') {
    console.log('Historical migration SQL was recorded and not executed. schema.sql is the current snapshot.');
  }
}

main()
  .then(() => pool.end())
  .catch((error) => {
    console.error(error.message || error);
    pool.end().finally(() => process.exit(1));
  });
