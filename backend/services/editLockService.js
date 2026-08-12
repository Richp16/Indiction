/**
 * Global app-wide edit lock — exactly one editor at a time.
 *
 * Acquire is transactional with SELECT … FOR UPDATE + unique singleton row
 * so concurrent acquires are decided by the database, not check-then-insert.
 */

const { pool, query } = require('../db');

/** Seconds without heartbeat before another user may claim the lock. */
const LOCK_TIMEOUT_SECONDS = Number(process.env.EDIT_LOCK_TIMEOUT_SECONDS || 90);

function isLockExpired(row, now = Date.now()) {
  if (!row?.last_heartbeat_at) return true;
  const last = new Date(row.last_heartbeat_at).getTime();
  return now - last > LOCK_TIMEOUT_SECONDS * 1000;
}

function serializeEditingUser(row) {
  if (!row) return null;
  return {
    userId: row.user_id,
    name: row.holder_name || row.holder_email || 'Another user',
    email: row.holder_email || null,
    role: row.holder_role || null,
  };
}

function serializeLock(row) {
  if (!row) return null;
  const editingUser = serializeEditingUser(row);
  return {
    holderUserId: row.user_id,
    holderName: editingUser.name,
    holderEmail: editingUser.email,
    holderRole: editingUser.role,
    acquiredAt: row.acquired_at,
    lastHeartbeatAt: row.last_heartbeat_at,
    expiresInSeconds: Math.max(
      0,
      LOCK_TIMEOUT_SECONDS -
        Math.floor((Date.now() - new Date(row.last_heartbeat_at).getTime()) / 1000)
    ),
    editingUser,
  };
}

async function loadUserDisplay(clientOrPool, userId) {
  const result = await clientOrPool.query(
    `SELECT id, name, email, role FROM users WHERE id = $1`,
    [userId]
  );
  const user = result.rows[0];
  if (!user) {
    return { name: 'Unknown user', email: null, role: null };
  }
  return {
    name: user.name || user.email || 'Unknown user',
    email: user.email || null,
    role: user.role || null,
  };
}

async function insertLock(client, userId, display) {
  const result = await client.query(
    `INSERT INTO active_edit_lock (
       singleton, user_id, holder_name, holder_email, holder_role
     ) VALUES (1, $1, $2, $3, $4)
     RETURNING *`,
    [userId, display.name, display.email, display.role]
  );
  return result.rows[0];
}

/**
 * Atomically acquire (or refresh) the global edit lock for userId.
 * Concurrent callers: one wins via FOR UPDATE + singleton PK.
 */
async function acquireLock(userId) {
  if (!userId) {
    const error = new Error('userId is required');
    error.statusCode = 400;
    throw error;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query(
      `SELECT * FROM active_edit_lock WHERE singleton = 1 FOR UPDATE`
    );
    const row = existing.rows[0] || null;

    if (row && !isLockExpired(row)) {
      if (String(row.user_id) === String(userId)) {
        const display = await loadUserDisplay(client, userId);
        const refreshed = await client.query(
          `UPDATE active_edit_lock
           SET last_heartbeat_at = now(),
               holder_name = $2,
               holder_email = $3,
               holder_role = $4
           WHERE singleton = 1 AND user_id = $1
           RETURNING *`,
          [userId, display.name, display.email, display.role]
        );
        await client.query('COMMIT');
        return {
          ok: true,
          isEditor: true,
          refreshed: true,
          lock: serializeLock(refreshed.rows[0]),
          editingUser: null,
        };
      }

      await client.query('COMMIT');
      return {
        ok: false,
        isEditor: false,
        lock: serializeLock(row),
        editingUser: serializeEditingUser(row),
      };
    }

    if (row && isLockExpired(row)) {
      await client.query(`DELETE FROM active_edit_lock WHERE singleton = 1`);
    }

    const display = await loadUserDisplay(client, userId);

    try {
      const inserted = await insertLock(client, userId, display);
      await client.query('COMMIT');
      return {
        ok: true,
        isEditor: true,
        refreshed: false,
        lock: serializeLock(inserted),
        editingUser: null,
      };
    } catch (error) {
      // Concurrent insert raced past FOR UPDATE on empty table; PK wins.
      if (error.code === '23505') {
        await client.query('ROLLBACK');
        const winner = await query(
          `SELECT * FROM active_edit_lock WHERE singleton = 1`
        );
        const winnerRow = winner.rows[0] || null;
        if (winnerRow && String(winnerRow.user_id) === String(userId)) {
          return {
            ok: true,
            isEditor: true,
            refreshed: true,
            lock: serializeLock(winnerRow),
            editingUser: null,
          };
        }
        return {
          ok: false,
          isEditor: false,
          lock: serializeLock(winnerRow),
          editingUser: serializeEditingUser(winnerRow),
        };
      }
      throw error;
    }
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore
    }
    throw error;
  } finally {
    client.release();
  }
}

async function heartbeatLock(userId) {
  const result = await query(
    `UPDATE active_edit_lock
     SET last_heartbeat_at = now()
     WHERE singleton = 1 AND user_id = $1
     RETURNING *`,
    [userId]
  );
  if (!result.rows[0]) {
    const current = await getLockStatus();
    return {
      ok: false,
      isEditor: false,
      lock: current.lock,
      editingUser: current.editingUser,
    };
  }
  return {
    ok: true,
    isEditor: true,
    lock: serializeLock(result.rows[0]),
    editingUser: null,
  };
}

async function releaseLock(userId) {
  const result = await query(
    `DELETE FROM active_edit_lock
     WHERE singleton = 1 AND user_id = $1
     RETURNING *`,
    [userId]
  );
  return { ok: true, released: result.rowCount > 0 };
}

/**
 * Status for polling. Purges a stale lock so the next acquire can succeed.
 */
async function getLockStatus() {
  const result = await query(`SELECT * FROM active_edit_lock WHERE singleton = 1`);
  const row = result.rows[0] || null;

  if (row && isLockExpired(row)) {
    await query(
      `DELETE FROM active_edit_lock
       WHERE singleton = 1
         AND last_heartbeat_at < now() - ($1::text || ' seconds')::interval`,
      [String(LOCK_TIMEOUT_SECONDS)]
    );
    return {
      lock: null,
      editingUser: null,
      timeoutSeconds: LOCK_TIMEOUT_SECONDS,
    };
  }

  return {
    lock: serializeLock(row),
    editingUser: serializeEditingUser(row),
    timeoutSeconds: LOCK_TIMEOUT_SECONDS,
  };
}

/**
 * Mutation gate: current user must already hold a non-stale lock.
 * Does not release on failed mutations — holder keeps the lock until
 * logout / explicit release / heartbeat timeout.
 */
async function assertHoldsGlobalLock(userId) {
  const status = await getLockStatus();
  if (!status.lock) {
    return {
      ok: false,
      reason: 'unlocked',
      editingUser: null,
      lock: null,
    };
  }
  if (String(status.lock.holderUserId) !== String(userId)) {
    return {
      ok: false,
      reason: 'held',
      editingUser: status.editingUser,
      lock: status.lock,
    };
  }
  return { ok: true, lock: status.lock, editingUser: null };
}

module.exports = {
  LOCK_TIMEOUT_SECONDS,
  acquireLock,
  heartbeatLock,
  releaseLock,
  getLockStatus,
  assertHoldsGlobalLock,
  serializeLock,
  serializeEditingUser,
  isLockExpired,
};
