const { Pool } = require('pg');
const { describeDatabaseTarget, resolveDatabaseSsl } = require('./databaseSsl');

const connectionString = process.env.DATABASE_URL;

const pool = new Pool({
  connectionString,
  ssl: resolveDatabaseSsl(connectionString),
});

async function query(text, params) {
  return pool.query(text, params);
}

module.exports = {
  pool,
  query,
  describeDatabaseTarget,
};
