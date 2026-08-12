/**
 * Server-side session idle / closing / revoke tests.
 * Requires DATABASE_URL and migration 017.
 */
require('dotenv').config();
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { query, pool } = require('../db');
const {
  createSession,
  validateSession,
  touchSession,
  endSession,
  markSessionClosing,
  isSessionStale,
  isSessionClosingExpired,
  SESSION_IDLE_SECONDS,
  SESSION_CLOSE_GRACE_SECONDS,
} = require('../services/sessionService');
const { acquireLock, getLockStatus } = require('../services/editLockService');

describe('sessionService', () => {
  let user;

  before(async () => {
    const table = await query(
      `SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'user_sessions'`
    );
    assert.ok(table.rows.length > 0, 'user_sessions missing — run migration 017');

    const users = await query(
      `SELECT id, email, role FROM users ORDER BY created_at ASC LIMIT 1`
    );
    assert.ok(users.rows.length > 0, 'Need at least one user');
    user = users.rows[0];
  });

  beforeEach(async () => {
    await query(`DELETE FROM user_sessions WHERE user_id = $1`, [user.id]);
    await query(`DELETE FROM active_edit_lock WHERE user_id = $1`, [user.id]);
  });

  after(async () => {
    await query(`DELETE FROM user_sessions WHERE user_id = $1`, [user.id]);
    await query(`DELETE FROM active_edit_lock WHERE user_id = $1`, [user.id]);
    await pool.end();
  });

  it('creates a live session that validates', async () => {
    const session = await createSession(user.id);
    const result = await validateSession(session.id, user.id);
    assert.equal(result.ok, true);
    assert.equal(String(result.session.user_id), String(user.id));
  });

  it('touchSession updates last_activity_at and clears closing_at', async () => {
    const session = await createSession(user.id);
    await markSessionClosing(session.id, user.id);
    const touched = await touchSession(session.id);
    assert.ok(touched);
    assert.equal(touched.closing_at, null);
    const ageMs = Date.now() - new Date(touched.last_activity_at).getTime();
    assert.ok(ageMs < 10_000, 'last_activity_at should be near now');
  });

  it('stale sessions fail validation and are revoked', async () => {
    const session = await createSession(user.id);
    await query(
      `UPDATE user_sessions
       SET last_activity_at = now() - (($1::text || ' seconds')::interval)
       WHERE id = $2`,
      [String(SESSION_IDLE_SECONDS + 5), session.id]
    );
    const row = (await query(`SELECT * FROM user_sessions WHERE id = $1`, [session.id]))
      .rows[0];
    assert.equal(isSessionStale(row), true);

    const result = await validateSession(session.id, user.id);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'SESSION_EXPIRED');

    const after = (
      await query(`SELECT revoked_at FROM user_sessions WHERE id = $1`, [session.id])
    ).rows[0];
    assert.ok(after.revoked_at);
  });

  it('closing grace: recent closing_at still validates; expired closing fails', async () => {
    const session = await createSession(user.id);
    await markSessionClosing(session.id, null);

    const stillOk = await validateSession(session.id, user.id);
    assert.equal(stillOk.ok, true);

    await query(
      `UPDATE user_sessions
       SET closing_at = now() - (($1::text || ' seconds')::interval)
       WHERE id = $2`,
      [String(SESSION_CLOSE_GRACE_SECONDS + 5), session.id]
    );
    const row = (await query(`SELECT * FROM user_sessions WHERE id = $1`, [session.id]))
      .rows[0];
    assert.equal(isSessionClosingExpired(row), true);

    const expired = await validateSession(session.id, user.id);
    assert.equal(expired.ok, false);
    assert.equal(expired.code, 'SESSION_EXPIRED');
  });

  it('endSession revokes immediately and releases edit lock', async () => {
    const session = await createSession(user.id);
    await acquireLock(user.id);
    const before = await getLockStatus();
    assert.equal(String(before.lock.holderUserId), String(user.id));

    const ended = await endSession(session.id, user.id);
    assert.equal(ended.revoked, true);
    assert.equal(ended.lockReleased, true);

    const afterLock = await getLockStatus();
    assert.equal(afterLock.lock, null);

    const validated = await validateSession(session.id, user.id);
    assert.equal(validated.ok, false);
  });

  it('markSessionClosing releases edit lock without hard-revoking yet', async () => {
    const session = await createSession(user.id);
    await acquireLock(user.id);

    const marked = await markSessionClosing(session.id, user.id);
    assert.equal(marked.lockReleased, true);

    const afterLock = await getLockStatus();
    assert.equal(afterLock.lock, null);

    const stillValid = await validateSession(session.id, user.id);
    assert.equal(stillValid.ok, true);
  });

  it('continuous heartbeat keeps session alive past what would be idle', async () => {
    const session = await createSession(user.id);
    await query(
      `UPDATE user_sessions
       SET last_activity_at = now() - (($1::text || ' seconds')::interval)
       WHERE id = $2`,
      [String(SESSION_IDLE_SECONDS - 30), session.id]
    );
    // Almost stale — heartbeat should refresh and keep valid.
    const touched = await touchSession(session.id);
    assert.ok(touched);
    const result = await validateSession(session.id, user.id);
    assert.equal(result.ok, true);
  });
});
