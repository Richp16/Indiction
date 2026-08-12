const {
  assertOrAcquireLock,
  dailyEntriesScope,
  certifiedPayrollScope,
  SCOPES,
} = require('../services/editLockService');
const { query } = require('../db');

function lockedResponse(res, lock) {
  const holder = lock?.holderName || 'another user';
  return res.status(423).json({
    code: 'EDIT_LOCK_HELD',
    message: `Read-only: ${holder} currently has edit rights. Try again when they finish or after the lock times out.`,
    lock,
  });
}

/**
 * Middleware: require edit lock for a fixed scope key or a resolver function.
 * Resolver may be sync or async and receives (req).
 */
function requireEditLock(scopeOrResolver) {
  return async (req, res, next) => {
    try {
      const scopeKey =
        typeof scopeOrResolver === 'function'
          ? await scopeOrResolver(req)
          : scopeOrResolver;

      if (!scopeKey) {
        return res.status(400).json({
          code: 'EDIT_LOCK_SCOPE_REQUIRED',
          message: 'Could not determine edit-lock scope for this request.',
        });
      }

      const result = await assertOrAcquireLock(scopeKey, req.user.userId);
      if (!result.ok) {
        return lockedResponse(res, result.lock);
      }

      req.editLock = result.lock;
      next();
    } catch (error) {
      const status = error.statusCode || 500;
      res.status(status).json({ message: error.message || 'Edit lock error' });
    }
  };
}

async function resolveDailyEntriesScopeFromBody(req) {
  const jobSiteId = req.body?.jobSiteId || req.body?.job_site_id;
  return dailyEntriesScope(jobSiteId);
}

async function resolveDailyEntriesScopeFromEntryId(req) {
  const result = await query(
    `SELECT job_site_id::text AS job_site_id FROM daily_time_entries WHERE id = $1`,
    [req.params.id]
  );
  if (!result.rows[0]) {
    const error = new Error('Entry not found');
    error.statusCode = 404;
    throw error;
  }
  return dailyEntriesScope(result.rows[0].job_site_id);
}

async function resolveCertifiedPayrollScope(req) {
  const jobSiteId =
    req.body?.jobSiteId || req.body?.job_site_id || req.query?.jobSiteId;
  return certifiedPayrollScope(jobSiteId);
}

const requireAdminConfigLock = requireEditLock(SCOPES.ADMIN_CONFIG);
const requirePayrollLock = requireEditLock(SCOPES.PAYROLL);
const requireDailyEntriesLockFromBody = requireEditLock(resolveDailyEntriesScopeFromBody);
const requireDailyEntriesLockFromId = requireEditLock(resolveDailyEntriesScopeFromEntryId);
const requireCertifiedPayrollLock = requireEditLock(resolveCertifiedPayrollScope);

module.exports = {
  requireEditLock,
  lockedResponse,
  requireAdminConfigLock,
  requirePayrollLock,
  requireDailyEntriesLockFromBody,
  requireDailyEntriesLockFromId,
  requireCertifiedPayrollLock,
  resolveDailyEntriesScopeFromBody,
  resolveDailyEntriesScopeFromEntryId,
  resolveCertifiedPayrollScope,
};
