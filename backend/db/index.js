const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Render Postgres requires SSL. This tells pg to use TLS,
  // and not to reject the certificate (Render uses its own CA).
  ssl: {
    rejectUnauthorized: false,
  },
});

async function query(text, params) {
  return pool.query(text, params);
}

module.exports = { pool, query };
