/**
 * Server-side session tracking for idle logout after tab close.
 *
 * JWT alone is 8h and cannot be invalidated when a tab disappears.
 * Sessions require periodic heartbeats; stale sessions are rejected with 401.
 *
 * Tab-close beacon marks the session as "closing" and releases the edit lock
 * immediately. A short grace window lets a page refresh resume the same
 * session via heartbeat; if no heartbeat arrives, the session expires.
 */

const { query } = require('../db');
const { releaseLock } = require('./editLockService');

/** Idle seconds without heartbeat before the session is treated as expired. */
const SESSION_IDLE_SECONDS = Number(process.env.SESSION_IDLE_SECONDS || 5 * 60);

/**
 * After logout-beacon, allow this many seconds for a refresh heartbeat
 * before treating the session as closed.
 */
const SESSION_CLOSE_GRACE_SECONDS = Number(
  process.env.SESSION_CLOSE_GRACE_SECONDS || 15
);

function isSessionStale(row, now = Date.now()) {
  if (!row?.last_activity_at) return true;
  if (row.revoked_at) return true;
  const last = new Date(row.last_activity_at).getTime();
  return now - last > SESSION_IDLE_SECONDS * 1000;
}

function isSessionClosingExpired(row, now = Date.now()) {
  if (!row?.closing_at) return false;
  const closing = new Date(row.closing_at).getTime();
  return now - closing > SESSION_CLOSE_GRACE_SECONDS * 1000;
}

async function createSession(userId) {
  const result = await query(
    `INSERT INTO user_sessions (user_id)
     VALUES ($1)
     RETURNING id, user_id, created_at, last_activity_at, revoked_at, closing_at`,
    [userId]
  );
  return result.rows[0];
}

async function getSession(sessionId) {
  if (!sessionId) return null;
  const result = await query(
    `SELECT id, user_id, created_at, last_activity_at, revoked_at, closing_at
     FROM user_sessions
     WHERE id = $1`,
    [sessionId]
  );
  return result.rows[0] || null;
}

/**
 * Validate a session for an authenticated request.
 * @returns {{ ok: true, session } | { ok: false, code: string, message: string }}
 */
async function validateSession(sessionId, userId) {
  const session = await getSession(sessionId);
  if (!session) {
    return {
      ok: false,
      code: 'SESSION_EXPIRED',
      message: 'Your session expired — please log in again',
    };
  }
  if (userId && String(session.user_id) !== String(userId)) {
    return {
      ok: false,
      code: 'SESSION_EXPIRED',
      message: 'Your session expired — please log in again',
    };
  }
  if (session.revoked_at) {
    return {
      ok: false,
      code: 'SESSION_EXPIRED',
      message: 'Your session expired — please log in again',
    };
  }
  if (isSessionClosingExpired(session) || isSessionStale(session)) {
    await revokeSession(session.id);
    return {
      ok: false,
      code: 'SESSION_EXPIRED',
      message: 'Your session expired — please log in again',
    };
  }
  return { ok: true, session };
}

async function touchSession(sessionId) {
  const result = await query(
    `UPDATE user_sessions
     SET last_activity_at = now(),
         closing_at = NULL
     WHERE id = $1
       AND revoked_at IS NULL
     RETURNING id, user_id, created_at, last_activity_at, revoked_at, closing_at`,
    [sessionId]
  );
  return result.rows[0] || null;
}

async function revokeSession(sessionId) {
  if (!sessionId) return { revoked: false };
  const result = await query(
    `UPDATE user_sessions
     SET revoked_at = COALESCE(revoked_at, now())
     WHERE id = $1
     RETURNING id, user_id`,
    [sessionId]
  );
  return {
    revoked: result.rowCount > 0,
    session: result.rows[0] || null,
  };
}

/**
 * Best-effort tab close: mark closing + release edit lock immediately.
 * Session stays valid briefly so a refresh can resume via heartbeat.
 */
async function markSessionClosing(sessionId, userId) {
  let lockReleased = false;
  if (sessionId) {
    await query(
      `UPDATE user_sessions
       SET closing_at = now()
       WHERE id = $1
         AND revoked_at IS NULL`,
      [sessionId]
    );
  }
  if (userId) {
    const lock = await releaseLock(userId);
    lockReleased = Boolean(lock.released);
  }
  return { marked: Boolean(sessionId), lockReleased };
}

/**
 * Hard end (explicit logout): revoke session + release edit lock.
 */
async function endSession(sessionId, userId) {
  const revoked = await revokeSession(sessionId);
  let lockReleased = false;
  const uid = userId || revoked.session?.user_id;
  if (uid) {
    const lock = await releaseLock(uid);
    lockReleased = Boolean(lock.released);
  }
  return { revoked: revoked.revoked, lockReleased };
}

module.exports = {
  SESSION_IDLE_SECONDS,
  SESSION_CLOSE_GRACE_SECONDS,
  createSession,
  getSession,
  validateSession,
  touchSession,
  revokeSession,
  markSessionClosing,
  endSession,
  isSessionStale,
  isSessionClosingExpired,
};
