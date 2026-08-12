const express = require('express');
const {
  acquireLock,
  heartbeatLock,
  releaseLock,
  getLockStatus,
  LOCK_TIMEOUT_SECONDS,
} = require('../services/editLockService');

const router = express.Router();

router.get('/status', async (req, res) => {
  try {
    const status = await getLockStatus();
    const isEditor =
      Boolean(status.lock) &&
      String(status.lock.holderUserId) === String(req.user.userId);
    res.json({
      isEditor,
      editingUser: isEditor ? null : status.editingUser,
      lock: status.lock,
      timeoutSeconds: status.timeoutSeconds,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post('/acquire', async (req, res) => {
  try {
    const result = await acquireLock(req.user.userId);
    if (!result.ok) {
      return res.status(423).json({
        code: 'EDIT_LOCK_HELD',
        isEditor: false,
        message: `Read-only: ${result.editingUser?.name || 'another user'} currently has edit rights.`,
        editingUser: result.editingUser,
        lock: result.lock,
        timeoutSeconds: LOCK_TIMEOUT_SECONDS,
      });
    }
    res.json({
      isEditor: true,
      editingUser: null,
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
    const result = await heartbeatLock(req.user.userId);
    if (!result.ok) {
      return res.status(403).json({
        code: 'EDIT_LOCK_NOT_HOLDER',
        isEditor: false,
        message: result.editingUser
          ? `Read-only: ${result.editingUser.name} currently has edit rights.`
          : 'Edit lock is no longer held by you.',
        editingUser: result.editingUser,
        lock: result.lock,
        timeoutSeconds: LOCK_TIMEOUT_SECONDS,
      });
    }
    res.json({
      isEditor: true,
      editingUser: null,
      lock: result.lock,
      timeoutSeconds: LOCK_TIMEOUT_SECONDS,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post('/release', async (req, res) => {
  try {
    const result = await releaseLock(req.user.userId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
