/**
 * Unit tests for edit lock service (resource-scoped, first-wins).
 * Requires DATABASE_URL and migration 015 applied.
 */
require('dotenv').config();
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { query, pool } = require('../db');
const {
  acquireLock,
  heartbeatLock,
  releaseLock,
  releaseAllForUser,
  getLockStatus,
  dailyEntriesScope,
  isLockExpired,
  LOCK_TIMEOUT_SECONDS,
} = require('../services/editLockService');

describe('editLockService', () => {
  let userA;
  let userB;
  const scope = dailyEntriesScope('00000000-0000-4000-8000-000000000099');

  before(async () => {
    const table = await query(
      `SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'edit_locks'`
    );
    assert.ok(table.rows.length > 0, 'edit_locks table missing — run migration 015');

    const users = await query(
      `SELECT id, email, name FROM users ORDER BY created_at ASC LIMIT 2`
    );
    assert.ok(users.rows.length >= 2, 'Need at least two users for lock tests');
    userA = users.rows[0];
    userB = users.rows[1];
  });

  beforeEach(async () => {
    await query(`DELETE FROM edit_locks WHERE scope_key = $1`, [scope]);
  });

  after(async () => {
    await query(`DELETE FROM edit_locks WHERE scope_key = $1`, [scope]);
    await pool.end();
  });

  it('first acquire wins; second user is blocked', async () => {
    const first = await acquireLock(scope, userA.id);
    assert.equal(first.ok, true);
    assert.equal(String(first.lock.holderUserId), String(userA.id));

    const second = await acquireLock(scope, userB.id);
    assert.equal(second.ok, false);
    assert.equal(second.reason, 'held');
    assert.equal(String(second.lock.holderUserId), String(userA.id));
  });

  it('same user can refresh / re-acquire', async () => {
    await acquireLock(scope, userA.id);
    const again = await acquireLock(scope, userA.id);
    assert.equal(again.ok, true);
    assert.equal(again.refreshed, true);
  });

  it('release allows another user to acquire', async () => {
    await acquireLock(scope, userA.id);
    await releaseLock(scope, userA.id);
    const second = await acquireLock(scope, userB.id);
    assert.equal(second.ok, true);
    assert.equal(String(second.lock.holderUserId), String(userB.id));
  });

  it('releaseAllForUser frees all scopes', async () => {
    const other = dailyEntriesScope('00000000-0000-4000-8000-000000000098');
    await acquireLock(scope, userA.id);
    await acquireLock(other, userA.id);
    const result = await releaseAllForUser(userA.id);
    assert.ok(result.releasedScopes.includes(scope));
    assert.ok(result.releasedScopes.includes(other));
    const status = await getLockStatus([scope, other]);
    assert.equal(status.locks[scope], undefined);
    assert.equal(status.locks[other], undefined);
  });

  it('heartbeat keeps lock alive for holder only', async () => {
    await acquireLock(scope, userA.id);
    const okBeat = await heartbeatLock(scope, userA.id);
    assert.equal(okBeat.ok, true);
    const badBeat = await heartbeatLock(scope, userB.id);
    assert.equal(badBeat.ok, false);
  });

  it('expired locks are reclaimable', async () => {
    await acquireLock(scope, userA.id);
    await query(
      `UPDATE edit_locks
       SET last_heartbeat_at = now() - (($1::text || ' seconds')::interval)
       WHERE scope_key = $2`,
      [String(LOCK_TIMEOUT_SECONDS + 5), scope]
    );
    const row = (
      await query(`SELECT * FROM edit_locks WHERE scope_key = $1`, [scope])
    ).rows[0];
    assert.equal(isLockExpired(row), true);

    const reclaim = await acquireLock(scope, userB.id);
    assert.equal(reclaim.ok, true);
    assert.equal(String(reclaim.lock.holderUserId), String(userB.id));
  });

  it('role does not affect priority (superintendent vs admin treated equally)', async () => {
    // Covered by first-wins using any two users; assert acquire ignores role.
    const first = await acquireLock(scope, userB.id);
    assert.equal(first.ok, true);
    const blocked = await acquireLock(scope, userA.id);
    assert.equal(blocked.ok, false);
    assert.equal(String(blocked.lock.holderUserId), String(userB.id));
  });
});
