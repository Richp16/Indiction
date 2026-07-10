require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { query } = require('../db');

async function main() {
  const raw = fs.readFileSync(
    path.join(__dirname, '../db/migrations/008_time_entries_aggregate.sql'),
    'utf8'
  );
  const upSql = raw.split('-- Down migration:')[0];
  console.log('Running 008_time_entries_aggregate.sql...');
  await query(upSql);
  console.log('Completed');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
