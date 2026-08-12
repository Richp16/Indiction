/**
 * Paychex API routes: sync/list pay periods; fetch checks only with validated IDs.
 *
 * Two local tables (do not mix):
 * - `pay_periods` — operational OPEN windows (Daily Entry / Payroll); filled by
 *   syncPayPeriods() with GET .../payperiods?status=OPEN
 * - `paychex_pay_periods` — historical COMPLETED catalog for /checks; filled by
 *   syncCompanyPayPeriods() with GET .../payperiods?status=COMPLETED&from=&to=
 *
 * These routes only read/write `paychex_pay_periods`.
 */

const express = require('express');
const { requireRole } = require('../middleware/roleGuard');
const { companyId } = require('../config/paychexApi');
const {
  syncCompanyPayPeriods,
  listLocalPayPeriods,
  requireLocalPayPeriod,
} = require('../services/paychexPayPeriodStore');
const {
  reconcileLocalPayPeriodsToPaychex,
} = require('../services/paychexPayPeriodReconcile');
const {
  getCompanyChecksByPayPeriod,
  getWorkerChecksByPayPeriod,
} = require('../services/paychexPayPeriodApi');
const { formatPaychexErrorForLog } = require('../services/paychexErrors');
const { requireGlobalEditLock } = require('../middleware/editLock');

const router = express.Router();
router.use(requireRole('system_admin', 'payroll_admin'));

function buildChecksErrorDebug(error) {
  const ctx = error.paychexContext || {};
  return {
    companyId: ctx.companyId || null,
    payPeriodId: ctx.payPeriodId || null,
    status: error.statusCode || null,
    errorCode: error.paychexErrorCode || error.code || null,
  };
}

function sendPaychexError(res, error) {
  const status = error.statusCode || 500;
  console.error('[Paychex route]', formatPaychexErrorForLog(error));

  const payload = {
    message: error.message,
    code: error.code || undefined,
  };

  // Debug details for Certified Payroll (frontend hides outside DEV).
  if (error.paychexContext?.endpoint?.includes('checks') || error.paychexContext?.payPeriodId) {
    payload.debug = buildChecksErrorDebug(error);
  }

  return res.status(status).json(payload);
}

/** Configured Flex company id for the UI (from env). */
router.get('/company', (_req, res) => {
  const id = companyId();
  if (!id) {
    return res.status(500).json({ message: 'PAYCHEX_COMPANY_ID is not configured' });
  }
  res.json({ companyId: id });
});

/**
 * GET /api/paychex/paycomponents
 * Admin debug: dump company pay components (id, name, type fields).
 * Use this to choose PAYCHEX_REIMBURSEMENT_COMPONENT_IDS.
 */
router.get('/paycomponents', async (_req, res) => {
  try {
    const {
      listCompanyPayComponents,
      getReimbursementComponentIds,
    } = require('../services/paychexRecurringSync');
    const components = await listCompanyPayComponents();
    res.json({
      companyId: companyId(),
      configuredReimbursementComponentIds: getReimbursementComponentIds(),
      count: components.length,
      components,
    });
  } catch (error) {
    sendPaychexError(res, error);
  }
});

/**
 * POST /api/paychex/sync-recurring-reimbursements
 * Pull recurring reimbursement amounts from Paychex into local cache.
 */
router.post('/sync-recurring-reimbursements', requireGlobalEditLock, async (_req, res) => {
  try {
    const {
      syncRecurringReimbursementsForAllWorkers,
    } = require('../services/paychexRecurringSync');
    const summary = await syncRecurringReimbursementsForAllWorkers();
    const status = summary.status === 'FAILED' ? 502 : 200;
    res.status(status).json(summary);
  } catch (error) {
    sendPaychexError(res, error);
  }
});

/**
 * GET /api/paychex/sync-status?type=pay_periods
 * Latest sync_log row for a sync_type (for "Last synced" UI).
 */
router.get('/sync-status', async (req, res) => {
  try {
    const { query } = require('../db');
    const type = String(req.query.type || '').trim();
    if (!type) {
      return res.status(400).json({ message: 'type query param is required' });
    }

    const result = await query(
      `SELECT sync_type AS "syncType",
              status,
              message,
              ran_at AS "lastRanAt"
       FROM sync_log
       WHERE sync_type = $1
       ORDER BY ran_at DESC
       LIMIT 1`,
      [type]
    );

    if (result.rows.length === 0) {
      return res.json({ syncType: type, status: null, message: null, lastRanAt: null });
    }
    res.json(result.rows[0]);
  } catch (error) {
    sendPaychexError(res, error);
  }
});

/**
 * POST /api/paychex/companies/:companyId/pay-periods/sync
 * Body: { from?, to?, statuses? }
 *
 * Syncs COMPLETED (default) Paychex periods into `paychex_pay_periods`.
 * Date bounds are normalized to full-day UTC without milliseconds.
 */
router.post('/companies/:companyId/pay-periods/sync', requireGlobalEditLock, async (req, res) => {
  try {
    const { from, to, statuses } = req.body || {};
    const summary = await syncCompanyPayPeriods({
      companyId: req.params.companyId,
      from,
      to,
      statuses,
    });
    res.json(summary);
  } catch (error) {
    sendPaychexError(res, error);
  }
});

/**
 * POST /api/paychex/companies/:companyId/pay-periods/reconcile
 *
 * Match operational pay_periods to paychex_pay_periods by end_date (±1 day)
 * and update pay_periods.paychex_period_id when safe.
 */
router.post('/companies/:companyId/pay-periods/reconcile', requireGlobalEditLock, async (req, res) => {
  try {
    const summary = await reconcileLocalPayPeriodsToPaychex({
      companyId: req.params.companyId,
    });
    res.json(summary);
  } catch (error) {
    sendPaychexError(res, error);
  }
});

/**
 * GET /api/paychex/companies/:companyId/pay-periods
 * Query: status?, from?, to?
 *
 * Returns rows from `paychex_pay_periods` only (not operational `pay_periods`).
 * Used by Settings and Certified Payroll dropdowns.
 * Each period includes label, week1/week2 bounds, and payPeriodId.
 */
router.get('/companies/:companyId/pay-periods', async (req, res) => {
  try {
    const periods = await listLocalPayPeriods(req.params.companyId, {
      status: req.query.status,
      from: req.query.from,
      to: req.query.to,
      hasHours: req.query.hasHours === 'true',
    });
    res.json({ periods, companyId: req.params.companyId });
  } catch (error) {
    sendPaychexError(res, error);
  }
});

/**
 * GET /api/paychex/companies/:companyId/checks?payPeriodId=
 * Validates payPeriodId against paychex_pay_periods before calling Paychex.
 */
router.get('/companies/:companyId/checks', async (req, res) => {
  try {
    const { companyId: pathCompanyId } = req.params;
    const payPeriodId = req.query.payPeriodId || req.query.payperiodid;

    await requireLocalPayPeriod(pathCompanyId, payPeriodId);

    const checks = await getCompanyChecksByPayPeriod({
      companyId: pathCompanyId,
      payPeriodId,
    });

    res.json({
      companyId: pathCompanyId,
      payPeriodId: String(payPeriodId).trim(),
      count: checks.length,
      checks,
    });
  } catch (error) {
    sendPaychexError(res, error);
  }
});

/**
 * GET /api/paychex/workers/:workerId/checks?companyId=&payPeriodId=
 * Validates payPeriodId against paychex_pay_periods for companyId.
 * Path uses workerId; query uses payPeriodId (never swap them).
 */
router.get('/workers/:workerId/checks', async (req, res) => {
  try {
    const { workerId } = req.params;
    const pathCompanyId = req.query.companyId;
    const payPeriodId = req.query.payPeriodId || req.query.payperiodid;

    if (!pathCompanyId) {
      return res.status(400).json({ message: 'companyId query parameter is required' });
    }

    await requireLocalPayPeriod(pathCompanyId, payPeriodId);

    const checks = await getWorkerChecksByPayPeriod({
      workerId,
      payPeriodId,
    });

    res.json({
      companyId: pathCompanyId,
      workerId,
      payPeriodId: String(payPeriodId).trim(),
      count: checks.length,
      checks,
    });
  } catch (error) {
    sendPaychexError(res, error);
  }
});

module.exports = router;
