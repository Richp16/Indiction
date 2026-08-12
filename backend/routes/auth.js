const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { query } = require('../db');
const { runAllSyncsGuarded } = require('../services/paychexSyncScheduler');
const {
  createSession,
  touchSession,
  endSession,
  markSessionClosing,
  validateSession,
  SESSION_IDLE_SECONDS,
} = require('../services/sessionService');

const router = express.Router();

// Slightly above the 6-hour scheduled cadence to avoid redundant login triggers.
const LOGIN_SYNC_STALE_THRESHOLD_MS =
  Number(process.env.LOGIN_SYNC_STALE_THRESHOLD_MS) || 7 * 60 * 60 * 1000;

async function triggerSyncIfStale() {
  const { rows } = await query(
    `SELECT MAX(ran_at) AS last_sync FROM sync_log WHERE status = 'SUCCESS'`
  );
  const lastSync = rows[0]?.last_sync ? new Date(rows[0].last_sync) : null;
  const isStale =
    !lastSync || Date.now() - lastSync.getTime() > LOGIN_SYNC_STALE_THRESHOLD_MS;

  if (isStale) {
    runAllSyncsGuarded('login').catch(() => {});
  }
}

function extractBearerToken(req) {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    return header.slice(7);
  }
  if (req.body?.token) return String(req.body.token);
  return null;
}

function decodeTokenSafe(token) {
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    try {
      // Allow revoke of expired JWTs on logout-beacon (session may still be open).
      return jwt.decode(token);
    } catch {
      return null;
    }
  }
}

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const result = await query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];

    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const session = await createSession(user.id);
    const token = jwt.sign(
      { userId: user.id, role: user.role, sessionId: session.id },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        name: user.name || null,
      },
      session: {
        id: session.id,
        idleSeconds: SESSION_IDLE_SECONDS,
      },
    });

    triggerSyncIfStale().catch(() => {});
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

/**
 * Activity heartbeat for ALL logged-in users (not just edit-lock holders).
 * Requires a valid (non-stale) session — first stale check happens in middleware
 * when this route is mounted behind auth. For simplicity this route verifies
 * the Bearer token itself so it can live on /api/auth before global auth.
 */
router.post('/heartbeat', async (req, res) => {
  try {
    const token = extractBearerToken(req);
    if (!token) {
      return res.status(401).json({
        code: 'UNAUTHORIZED',
        message: 'Unauthorized',
      });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      return res.status(401).json({
        code: 'SESSION_EXPIRED',
        message: 'Your session expired — please log in again',
      });
    }

    const sessionId = decoded.sessionId;
    if (!sessionId) {
      return res.status(401).json({
        code: 'SESSION_EXPIRED',
        message: 'Your session expired — please log in again',
      });
    }

    const validated = await validateSession(sessionId, decoded.userId);
    if (!validated.ok) {
      return res.status(401).json({
        code: validated.code,
        message: validated.message,
      });
    }

    const touched = await touchSession(sessionId);
    if (!touched) {
      return res.status(401).json({
        code: 'SESSION_EXPIRED',
        message: 'Your session expired — please log in again',
      });
    }

    res.json({
      ok: true,
      lastActivityAt: touched.last_activity_at,
      idleSeconds: SESSION_IDLE_SECONDS,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

/**
 * Explicit logout (Bearer or body token). Revokes session + releases edit lock.
 */
router.post('/logout', async (req, res) => {
  try {
    const token = extractBearerToken(req);
    if (!token) {
      return res.json({ ok: true, revoked: false });
    }
    const decoded = decodeTokenSafe(token);
    if (!decoded?.sessionId) {
      return res.json({ ok: true, revoked: false });
    }
    const result = await endSession(decoded.sessionId, decoded.userId);
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

/**
 * Best-effort tab-close logout via sendBeacon.
 * Accepts JSON body { token } (sendBeacon cannot set Authorization headers).
 * Marks the session closing (grace for refresh) and releases the edit lock now.
 */
router.post('/logout-beacon', async (req, res) => {
  try {
    const token = extractBearerToken(req);
    if (!token) {
      return res.status(204).end();
    }
    const decoded = decodeTokenSafe(token);
    if (decoded?.sessionId) {
      await markSessionClosing(decoded.sessionId, decoded.userId);
    }
    res.status(204).end();
  } catch (error) {
    // Always succeed for beacon callers — do not block unload.
    console.error('[auth/logout-beacon]', error.message);
    res.status(204).end();
  }
});

module.exports = router;
module.exports.SESSION_IDLE_SECONDS = SESSION_IDLE_SECONDS;
