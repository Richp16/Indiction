require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { query, pool } = require('../db');

async function main() {
  const raw = fs.readFileSync(
    path.join(__dirname, '../db/migrations/018_non_paychex_mode.sql'),
    'utf8'
  );
  await query(raw);

  const cols = await query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'company_settings'
       AND column_name IN ('paychex_enabled', 'integration_configured')`
  );
  console.log('company_settings columns:', cols.rows.map((r) => r.column_name).join(', ') || 'MISSING');
}

main()
  .then(() => pool.end())
  .catch((err) => {
    console.error(err.message);
    pool.end();
    process.exit(1);
  });
