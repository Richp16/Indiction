const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');
const ADVISORY_LOCK_KEY = 814271001;

function listMigrationFiles() {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => /^\d+.+\.sql$/.test(name))
    .sort((left, right) => {
      const leftNumber = parseInt(left, 10);
      const rightNumber = parseInt(right, 10);
      if (leftNumber !== rightNumber) return leftNumber - rightNumber;
      return left.localeCompare(right);
    });
}

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function appliedFilenames(client) {
  const result = await client.query('SELECT filename FROM schema_migrations');
  return new Set(result.rows.map((row) => row.filename));
}

async function usersTableExists(client) {
  const result = await client.query(`SELECT to_regclass('public.users') AS users`);
  return Boolean(result.rows[0].users);
}

async function schemaMatchesSnapshot(client) {
  const result = await client.query(`
    SELECT
      to_regclass('public.active_edit_lock') IS NOT NULL AS edit_lock,
      to_regclass('public.user_sessions') IS NOT NULL AS sessions,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'company_settings'
          AND column_name = 'integration_configured'
      ) AS integration_configured,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'workers'
          AND column_name = 'address'
      ) AS worker_address,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'pay_periods'
          AND column_name = 'finalized_at'
      ) AS finalized_at
  `);
  const row = result.rows[0];
  return Boolean(
    row.edit_lock &&
      row.sessions &&
      row.integration_configured &&
      row.worker_address &&
      row.finalized_at
  );
}

async function stampMigrations(client, filenames) {
  for (const filename of filenames) {
    await client.query(
      `INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING`,
      [filename]
    );
  }
}

async function applyFreshSnapshot(client, filenames) {
  const schemaSql = fs.readFileSync(SCHEMA_PATH, 'utf8');
  await client.query('BEGIN');
  try {
    await client.query(schemaSql);
    for (const filename of filenames) {
      await client.query(
        `INSERT INTO schema_migrations (filename) VALUES ($1)`,
        [filename]
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function applyOneMigration(client, filename) {
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, filename), 'utf8');
  await client.query('BEGIN');
  try {
    await client.query(sql);
    await client.query(
      `INSERT INTO schema_migrations (filename) VALUES ($1)`,
      [filename]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    const wrapped = new Error(`Migration ${filename} failed: ${error.message}`);
    wrapped.cause = error;
    throw wrapped;
  }
}

/**
 * Empty database: apply schema.sql and record every historical migration as
 * applied without executing it. Tracked database: run only new SQL files.
 * --baseline records history for a database that already matches schema.sql.
 */
async function runMigrations(pool, { baseline = false } = {}) {
  const filenames = listMigrationFiles();
  const client = await pool.connect();
  let locked = false;

  try {
    await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_KEY]);
    locked = true;
    await ensureMigrationsTable(client);

    const applied = await appliedFilenames(client);
    const pending = filenames.filter((filename) => !applied.has(filename));
    const hasUsers = await usersTableExists(client);

    if (baseline) {
      if (!hasUsers || !(await schemaMatchesSnapshot(client))) {
        throw new Error(
          'Refusing --baseline. The database does not match the current schema snapshot. ' +
            'On an empty database run npm run migrate. On an older database, apply the missing changes before baselining.'
        );
      }
      await client.query('BEGIN');
      try {
        await stampMigrations(client, filenames);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
      return {
        mode: 'baseline',
        applied: [],
        skipped: filenames,
      };
    }

    if (!hasUsers) {
      await applyFreshSnapshot(client, filenames);
      return {
        mode: 'fresh',
        applied: ['schema.sql'],
        skipped: filenames,
      };
    }

    if (applied.size === 0) {
      throw new Error(
        'This database has tables but no schema_migrations history. ' +
          'If it already matches backend/db/schema.sql, run: npm run migrate -- --baseline. ' +
          'Historical files 001–019 are not safe to replay on the current snapshot.'
      );
    }

    const appliedNow = [];
    for (const filename of pending) {
      await applyOneMigration(client, filename);
      appliedNow.push(filename);
    }

    return {
      mode: 'upgrade',
      applied: appliedNow,
      skipped: filenames.filter((filename) => applied.has(filename)),
    };
  } finally {
    if (locked) {
      await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]).catch(() => {});
    }
    client.release();
  }
}

module.exports = {
  listMigrationFiles,
  runMigrations,
  schemaMatchesSnapshot,
};
