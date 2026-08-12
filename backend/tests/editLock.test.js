/**
 * Global edit-lock tests (singleton row, atomic acquire).
 * Requires DATABASE_URL and migration 016 applied.
 */
require('dotenv').config();
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { query, pool } = require('../db');
const {
  acquireLock,
  heartbeatLock,
  releaseLock,
  getLockStatus,
  assertHoldsGlobalLock,
  isLockExpired,
  LOCK_TIMEOUT_SECONDS,
} = require('../services/editLockService');

describe('global editLockService', () => {
  let userA;
  let userB;

  before(async () => {
    const table = await query(
      `SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'active_edit_lock'`
    );
    assert.ok(table.rows.length > 0, 'active_edit_lock missing — run migration 016');

    const old = await query(
      `SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'edit_locks'`
    );
    assert.equal(old.rows.length, 0, 'scoped edit_locks table should be gone');

    const users = await query(
      `SELECT id, email, name, role FROM users ORDER BY created_at ASC LIMIT 2`
    );
    assert.ok(users.rows.length >= 2, 'Need at least two users for lock tests');
    userA = users.rows[0];
    userB = users.rows[1];
  });

  beforeEach(async () => {
    await query(`DELETE FROM active_edit_lock`);
  });

  after(async () => {
    await query(`DELETE FROM active_edit_lock`);
    await pool.end();
  });

  it('first acquire wins; second user is blocked with editingUser', async () => {
    const first = await acquireLock(userA.id);
    assert.equal(first.ok, true);
    assert.equal(first.isEditor, true);

    const second = await acquireLock(userB.id);
    assert.equal(second.ok, false);
    assert.equal(second.isEditor, false);
    assert.equal(String(second.editingUser.userId), String(userA.id));
    assert.ok(second.editingUser.name);
  });

  it('same user can refresh / re-acquire', async () => {
    await acquireLock(userA.id);
    const again = await acquireLock(userA.id);
    assert.equal(again.ok, true);
    assert.equal(again.refreshed, true);
  });

  it('explicit release frees the lock for the next acquire', async () => {
    await acquireLock(userA.id);
    const released = await releaseLock(userA.id);
    assert.equal(released.released, true);

    const second = await acquireLock(userB.id);
    assert.equal(second.ok, true);
    assert.equal(String(second.lock.holderUserId), String(userB.id));
  });

  it('heartbeat keeps lock alive for holder only', async () => {
    await acquireLock(userA.id);
    const okBeat = await heartbeatLock(userA.id);
    assert.equal(okBeat.ok, true);
    const badBeat = await heartbeatLock(userB.id);
    assert.equal(badBeat.ok, false);
  });

  it('stale lock is reclaimed by a new acquire', async () => {
    await acquireLock(userA.id);
    await query(
      `UPDATE active_edit_lock
       SET last_heartbeat_at = now() - (($1::text || ' seconds')::interval)
       WHERE singleton = 1`,
      [String(LOCK_TIMEOUT_SECONDS + 5)]
    );
    const row = (await query(`SELECT * FROM active_edit_lock`)).rows[0];
    assert.equal(isLockExpired(row), true);

    const reclaim = await acquireLock(userB.id);
    assert.equal(reclaim.ok, true);
    assert.equal(String(reclaim.lock.holderUserId), String(userB.id));
  });

  it('assertHoldsGlobalLock allows holder and rejects non-holder (423 semantics)', async () => {
    await acquireLock(userA.id);
    const ok = await assertHoldsGlobalLock(userA.id);
    assert.equal(ok.ok, true);

    const blocked = await assertHoldsGlobalLock(userB.id);
    assert.equal(blocked.ok, false);
    assert.equal(blocked.reason, 'held');
    assert.equal(String(blocked.editingUser.userId), String(userA.id));
  });

  it('concurrent acquire attempts: exactly one winner', async () => {
    let winnerCount = { [userA.id]: 0, [userB.id]: 0 };

    for (let i = 0; i < 25; i += 1) {
      await query(`DELETE FROM active_edit_lock`);
      const results = await Promise.all([
        acquireLock(userA.id),
        acquireLock(userB.id),
        acquireLock(userA.id),
        acquireLock(userB.id),
        acquireLock(userA.id),
        acquireLock(userB.id),
      ]);

      const winners = results.filter((r) => r.ok);
      const losers = results.filter((r) => !r.ok);
      assert.ok(winners.length >= 1, 'at least one acquire must succeed');

      const holderIds = new Set(
        winners.map((r) => String(r.lock.holderUserId))
      );
      assert.equal(
        holderIds.size,
        1,
        `exactly one holder expected, got ${[...holderIds].join(',')}`
      );

      const holderId = [...holderIds][0];
      winnerCount[holderId] = (winnerCount[holderId] || 0) + 1;

      // Every success must be the same holder; losers must report that holder.
      for (const loser of losers) {
        assert.equal(String(loser.editingUser.userId), holderId);
      }

      const status = await getLockStatus();
      assert.equal(String(status.lock.holderUserId), holderId);
    }

    // Sanity: lock table never has >1 row.
    const count = await query(`SELECT COUNT(*)::int AS n FROM active_edit_lock`);
    assert.equal(count.rows[0].n, 1);
  });

  it('role does not affect priority', async () => {
    const first = await acquireLock(userB.id);
    assert.equal(first.ok, true);
    const blocked = await acquireLock(userA.id);
    assert.equal(blocked.ok, false);
    assert.equal(String(blocked.editingUser.userId), String(userB.id));
  });
});
