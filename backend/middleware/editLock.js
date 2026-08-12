const { assertHoldsGlobalLock } = require('../services/editLockService');

function lockedResponse(res, { editingUser, lock, reason } = {}) {
  const holder = editingUser?.name || lock?.holderName || 'another user';
  const message =
    reason === 'unlocked'
      ? 'Read-only: no active editor lock. Refresh or wait for edit rights to become available.'
      : `Read-only: ${holder} currently has edit rights. Try again when they finish or after the lock times out.`;

  return res.status(423).json({
    code: 'EDIT_LOCK_HELD',
    message,
    editingUser: editingUser || lock?.editingUser || null,
    lock: lock || null,
  });
}

/**
 * Require the requesting user to hold the global edit lock.
 * Applied identically to every mutating route — no role/resource exceptions.
 */
async function requireGlobalEditLock(req, res, next) {
  try {
    const result = await assertHoldsGlobalLock(req.user.userId);
    if (!result.ok) {
      return lockedResponse(res, result);
    }
    req.editLock = result.lock;
    next();
  } catch (error) {
    const status = error.statusCode || 500;
    res.status(status).json({ message: error.message || 'Edit lock error' });
  }
}

module.exports = {
  requireGlobalEditLock,
  lockedResponse,
};
