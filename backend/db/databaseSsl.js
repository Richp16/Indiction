const fs = require('fs');

function describeDatabaseTarget(connectionString) {
  if (!connectionString) return '(DATABASE_URL is not set)';
  try {
    const parsed = new URL(connectionString);
    const database = parsed.pathname.replace(/^\//, '') || '(no database)';
    const port = parsed.port || '5432';
    return `${parsed.hostname}:${port}/${database}`;
  } catch {
    return '(DATABASE_URL is not a valid URL)';
  }
}

function sslFromMode(mode, connectionString) {
  if (mode === 'disable' || mode === 'false' || mode === '0' || mode === 'off') {
    return false;
  }
  if (mode === 'require' || mode === 'true' || mode === '1' || mode === 'on') {
    return { rejectUnauthorized: false };
  }
  if (mode === 'verify-full' || mode === 'verify-ca') {
    const caPath = process.env.DATABASE_SSL_CA;
    if (!caPath || !String(caPath).trim()) {
      throw new Error('DATABASE_SSL=verify-full requires DATABASE_SSL_CA to point at a CA certificate file');
    }
    return {
      rejectUnauthorized: true,
      ca: fs.readFileSync(caPath, 'utf8'),
    };
  }
  throw new Error(
    `DATABASE_SSL must be false, require, or verify-full (received ${mode})`
  );
}

/**
 * Local PostgreSQL does not use TLS. Hosted Postgres usually does.
 * DATABASE_SSL overrides the URL. If it is unset, sslmode=require in
 * DATABASE_URL still enables TLS without certificate verification.
 */
function resolveDatabaseSsl(connectionString) {
  const explicit = process.env.DATABASE_SSL;
  if (explicit != null && String(explicit).trim() !== '') {
    return sslFromMode(String(explicit).trim().toLowerCase(), connectionString);
  }

  if (!connectionString) return false;
  try {
    const mode = new URL(connectionString).searchParams.get('sslmode');
    if (!mode) return false;
    const normalized = mode.toLowerCase();
    if (normalized === 'disable') return false;
    if (normalized === 'verify-full' || normalized === 'verify-ca') {
      return sslFromMode(normalized, connectionString);
    }
    if (normalized === 'require' || normalized === 'prefer' || normalized === 'allow') {
      return { rejectUnauthorized: false };
    }
  } catch {
    return false;
  }
  return false;
}

module.exports = {
  describeDatabaseTarget,
  resolveDatabaseSsl,
};
