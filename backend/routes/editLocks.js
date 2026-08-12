const express = require('express');
const {
  acquireLock,
  heartbeatLock,
  releaseLock,
  releaseAllForUser,
  getLockStatus,
  LOCK_TIMEOUT_SECONDS,
} = require('../services/editLockService');

const router = express.Router();

router.get('/status', async (req, res) => {
  try {
    const raw = req.query.scopes;
    const scopeKeys = raw
      ? String(raw)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : null;
    const status = await getLockStatus(scopeKeys);
    res.json(status);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post('/acquire', async (req, res) => {
  try {
    const scopeKey = String(req.body?.scopeKey || '').trim();
    if (!scopeKey) {
      return res.status(400).json({ message: 'scopeKey is required' });
    }
    const result = await acquireLock(scopeKey, req.user.userId);
    if (!result.ok) {
      return res.status(423).json({
        code: 'EDIT_LOCK_HELD',
        message: `Read-only: ${result.lock?.holderName || 'another user'} currently has edit rights.`,
        lock: result.lock,
        timeoutSeconds: LOCK_TIMEOUT_SECONDS,
      });
    }
    res.json({
      ok: true,
      lock: result.lock,
      refreshed: Boolean(result.refreshed),
      timeoutSeconds: LOCK_TIMEOUT_SECONDS,
    });
  } catch (error) {
    const status = error.statusCode || 500;
    res.status(status).json({ message: error.message });
  }
});

router.post('/heartbeat', async (req, res) => {
  try {
    const scopeKey = String(req.body?.scopeKey || '').trim();
    if (!scopeKey) {
      return res.status(400).json({ message: 'scopeKey is required' });
    }
    const result = await heartbeatLock(scopeKey, req.user.userId);
    if (!result.ok) {
      return res.status(423).json({
        code: 'EDIT_LOCK_HELD',
        message: result.lock
          ? `Read-only: ${result.lock.holderName} currently has edit rights.`
          : 'Edit lock is no longer held by you.',
        lock: result.lock,
        timeoutSeconds: LOCK_TIMEOUT_SECONDS,
      });
    }
    res.json({ ok: true, lock: result.lock, timeoutSeconds: LOCK_TIMEOUT_SECONDS });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post('/release', async (req, res) => {
  try {
    const scopeKey = String(req.body?.scopeKey || '').trim();
    if (!scopeKey) {
      return res.status(400).json({ message: 'scopeKey is required' });
    }
    const result = await releaseLock(scopeKey, req.user.userId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post('/release-all', async (req, res) => {
  try {
    const result = await releaseAllForUser(req.user.userId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
