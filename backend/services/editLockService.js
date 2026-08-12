/**
 * Resource-scoped edit locks (first holder wins; role does not matter).
 *
 * Scopes:
 *   daily_entries:{jobSiteId}      — Daily Entry / My Entries mutations
 *   certified_payroll:{jobSiteId}  — Certified Payroll mutations for a site
 *   admin_config                   — job sites, workers, classifications, rates,
 *                                    company settings, users
 *   payroll                        — payroll export edits, submit, period syncs
 */

const { query } = require('../db');

/** Seconds without heartbeat before another user may claim the lock. */
const LOCK_TIMEOUT_SECONDS = Number(process.env.EDIT_LOCK_TIMEOUT_SECONDS || 300);

const SCOPES = {
  DAILY_ENTRIES: 'daily_entries',
  CERTIFIED_PAYROLL: 'certified_payroll',
  ADMIN_CONFIG: 'admin_config',
  PAYROLL: 'payroll',
};

function dailyEntriesScope(jobSiteId) {
  const id = jobSiteId != null && String(jobSiteId).trim() !== ''
    ? String(jobSiteId)
    : '_none';
  return `${SCOPES.DAILY_ENTRIES}:${id}`;
}

function certifiedPayrollScope(jobSiteId) {
  if (jobSiteId == null || String(jobSiteId).trim() === '') return null;
  return `${SCOPES.CERTIFIED_PAYROLL}:${jobSiteId}`;
}

function isLockExpired(row, now = Date.now()) {
  if (!row?.last_heartbeat_at) return true;
  const last = new Date(row.last_heartbeat_at).getTime();
  return now - last > LOCK_TIMEOUT_SECONDS * 1000;
}

function serializeLock(row) {
  if (!row) return null;
  return {
    scopeKey: row.scope_key,
    holderUserId: row.holder_user_id,
    holderName: row.holder_name || row.holder_email || 'Another user',
    holderEmail: row.holder_email || null,
    acquiredAt: row.acquired_at,
    lastHeartbeatAt: row.last_heartbeat_at,
    expiresInSeconds: Math.max(
      0,
      LOCK_TIMEOUT_SECONDS -
        Math.floor((Date.now() - new Date(row.last_heartbeat_at).getTime()) / 1000)
    ),
  };
}

async function loadUserDisplay(userId) {
  const result = await query(
    `SELECT id, name, email FROM users WHERE id = $1`,
    [userId]
  );
  const user = result.rows[0];
  if (!user) {
    return { name: 'Unknown user', email: null };
  }
  return {
    name: user.name || user.email || 'Unknown user',
    email: user.email || null,
  };
}

async function getLockRow(scopeKey) {
  const result = await query(`SELECT * FROM edit_locks WHERE scope_key = $1`, [scopeKey]);
  return result.rows[0] || null;
}

async function purgeExpiredLock(scopeKey) {
  const row = await getLockRow(scopeKey);
  if (row && isLockExpired(row)) {
    await query(`DELETE FROM edit_locks WHERE scope_key = $1`, [scopeKey]);
    return true;
  }
  return false;
}

/**
 * Acquire (or refresh) a lock for the given user.
 * First holder wins; same holder may re-acquire to refresh heartbeat.
 */
async function acquireLock(scopeKey, userId) {
  if (!scopeKey || !userId) {
    const error = new Error('scopeKey and userId are required');
    error.statusCode = 400;
    throw error;
  }

  await purgeExpiredLock(scopeKey);
  const existing = await getLockRow(scopeKey);

  if (existing && String(existing.holder_user_id) !== String(userId)) {
    return {
      ok: false,
      reason: 'held',
      lock: serializeLock(existing),
    };
  }

  const display = await loadUserDisplay(userId);

  if (existing) {
    const result = await query(
      `UPDATE edit_locks
       SET last_heartbeat_at = now(),
           holder_name = $2,
           holder_email = $3
       WHERE scope_key = $1 AND holder_user_id = $4
       RETURNING *`,
      [scopeKey, display.name, display.email, userId]
    );
    return { ok: true, lock: serializeLock(result.rows[0]), refreshed: true };
  }

  try {
    const result = await query(
      `INSERT INTO edit_locks (scope_key, holder_user_id, holder_name, holder_email)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [scopeKey, userId, display.name, display.email]
    );
    return { ok: true, lock: serializeLock(result.rows[0]), refreshed: false };
  } catch (error) {
    // Race: another user inserted first.
    if (error.code === '23505') {
      const winner = await getLockRow(scopeKey);
      return {
        ok: false,
        reason: 'held',
        lock: serializeLock(winner),
      };
    }
    throw error;
  }
}

async function heartbeatLock(scopeKey, userId) {
  await purgeExpiredLock(scopeKey);
  const result = await query(
    `UPDATE edit_locks
     SET last_heartbeat_at = now()
     WHERE scope_key = $1 AND holder_user_id = $2
     RETURNING *`,
    [scopeKey, userId]
  );
  if (!result.rows[0]) {
    return { ok: false, reason: 'not_holder', lock: serializeLock(await getLockRow(scopeKey)) };
  }
  return { ok: true, lock: serializeLock(result.rows[0]) };
}

async function releaseLock(scopeKey, userId) {
  const result = await query(
    `DELETE FROM edit_locks
     WHERE scope_key = $1 AND holder_user_id = $2
     RETURNING *`,
    [scopeKey, userId]
  );
  return { ok: true, released: result.rowCount > 0 };
}

async function releaseAllForUser(userId) {
  const result = await query(
    `DELETE FROM edit_locks WHERE holder_user_id = $1 RETURNING scope_key`,
    [userId]
  );
  return {
    ok: true,
    releasedScopes: result.rows.map((row) => row.scope_key),
  };
}

async function getLockStatus(scopeKeys = null) {
  // Opportunistic cleanup of stale locks.
  await query(
    `DELETE FROM edit_locks
     WHERE last_heartbeat_at < now() - ($1::text || ' seconds')::interval`,
    [String(LOCK_TIMEOUT_SECONDS)]
  );

  let result;
  if (Array.isArray(scopeKeys) && scopeKeys.length > 0) {
    result = await query(
      `SELECT * FROM edit_locks WHERE scope_key = ANY($1::text[])`,
      [scopeKeys]
    );
  } else {
    result = await query(`SELECT * FROM edit_locks ORDER BY scope_key`);
  }

  const locks = {};
  for (const row of result.rows) {
    locks[row.scope_key] = serializeLock(row);
  }
  return {
    locks,
    timeoutSeconds: LOCK_TIMEOUT_SECONDS,
  };
}

/**
 * Assert current user holds the lock (or acquire if free/expired).
 * Used by mutation middleware — first caller wins.
 */
async function assertOrAcquireLock(scopeKey, userId) {
  const acquired = await acquireLock(scopeKey, userId);
  if (acquired.ok) return acquired;
  return acquired;
}

module.exports = {
  LOCK_TIMEOUT_SECONDS,
  SCOPES,
  dailyEntriesScope,
  certifiedPayrollScope,
  acquireLock,
  heartbeatLock,
  releaseLock,
  releaseAllForUser,
  getLockStatus,
  assertOrAcquireLock,
  serializeLock,
  isLockExpired,
};
