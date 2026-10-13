const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { describeDatabaseTarget, resolveDatabaseSsl } = require('../db/databaseSsl');
const { listMigrationFiles } = require('../db/migrate');
const { safePaychexFailure } = require('../middleware/paychexGuard');
const { isValidEmail, MIN_PASSWORD_LENGTH } = require('../scripts/create-admin');

describe('database SSL and logging', () => {
  const originalSsl = process.env.DATABASE_SSL;
  const originalCa = process.env.DATABASE_SSL_CA;

  function restore() {
    if (originalSsl == null) delete process.env.DATABASE_SSL;
    else process.env.DATABASE_SSL = originalSsl;
    if (originalCa == null) delete process.env.DATABASE_SSL_CA;
    else process.env.DATABASE_SSL_CA = originalCa;
  }

  it('describes a database URL without the password', () => {
    const described = describeDatabaseTarget(
      'postgresql://indiction_app:s3cret@localhost:5432/indiction'
    );
    assert.equal(described, 'localhost:5432/indiction');
    assert.equal(described.includes('s3cret'), false);
  });

  it('disables SSL for a local URL when DATABASE_SSL is false', () => {
    process.env.DATABASE_SSL = 'false';
    assert.equal(
      resolveDatabaseSsl('postgresql://indiction_app:pw@localhost:5432/indiction'),
      false
    );
    restore();
  });

  it('enables SSL when the URL asks for sslmode=require and DATABASE_SSL is unset', () => {
    delete process.env.DATABASE_SSL;
    const ssl = resolveDatabaseSsl(
      'postgresql://indiction_app:pw@db.example.com:5432/indiction?sslmode=require'
    );
    assert.deepEqual(ssl, { rejectUnauthorized: false });
    restore();
  });
});

describe('migration discovery', () => {
  it('lists historical files in numeric order and keeps 015 before 016', () => {
    const files = listMigrationFiles();
    const numbers = files.map((name) => parseInt(name, 10));
    const sorted = [...numbers].sort((a, b) => a - b);
    assert.deepEqual(numbers, sorted);
    assert.ok(files.some((name) => name.startsWith('015_')));
    assert.ok(files.some((name) => name.startsWith('016_')));
    const index015 = files.findIndex((name) => name.startsWith('015_'));
    const index016 = files.findIndex((name) => name.startsWith('016_'));
    assert.ok(index015 < index016);
  });
});

describe('admin and Paychex setup helpers', () => {
  it('checks email shape', () => {
    assert.equal(isValidEmail('admin@example.com'), true);
    assert.equal(isValidEmail('not-an-email'), false);
    assert.equal(MIN_PASSWORD_LENGTH >= 10, true);
  });

  it('does not include response bodies in Paychex health guidance', () => {
    const message = safePaychexFailure({
      error: { statusCode: 401, networkCode: null },
    });
    assert.match(message, /client id or secret/i);
    assert.equal(message.includes('access_token'), false);
    assert.equal(message.includes('secret'), true);
  });
});
