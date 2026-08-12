const express = require('express');
const { query } = require('../db');
const { requireRole } = require('../middleware/roleGuard');
const {
  createDailyEntry,
  updateDailyEntry,
  deleteDailyEntry,
  DailyEntryError,
} = require('../services/dailyEntryService');
const { getWeekBounds } = require('../services/entryPayCode');
const { requireGlobalEditLock } = require('../middleware/editLock');

const router = express.Router();

const ADMIN_ROLES = ['system_admin', 'payroll_admin'];

/**
 * Superintendents (and other non-admins) may only enter time for the current
 * Sunday–Saturday week. Admins may enter any date that maps to a pay period
 * (validated later by dailyEntryService / resolvePayPeriodForDate).
 */
function assertEntryDateAllowedForRole(role, dateWorked) {
  if (ADMIN_ROLES.includes(role)) {
    return;
  }

  const date = String(dateWorked || '').split('T')[0];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const error = new Error('Work date is required');
    error.statusCode = 400;
    throw error;
  }

  const today = new Date().toISOString().split('T')[0];
  const { sunday, saturday } = getWeekBounds(today);
  if (date < sunday || date > saturday) {
    const error = new Error(
      'You do not have permission to enter time outside the current week.'
    );
    error.statusCode = 403;
    throw error;
  }
}

function mapDailyRowToLegacyShape(row) {
  if (!row) return row;
  return {
    ...row,
    entry_date: row.date_worked,
    hours: row.hours_worked,
    paychex_component_id: row.paychex_component_id,
  };
}

router.post('/', requireGlobalEditLock, async (req, res) => {
  try {
    const {
      workerId,
      jobSiteId,
      payPeriodId,
      paychexComponentId,
      payCode,
      entryDate,
      entry_date,
      hours,
      reimbursementAmount,
    } = req.body;

    const dateWorked = entry_date || entryDate;
    assertEntryDateAllowedForRole(req.user?.role, dateWorked);

    const allowNegative = ADMIN_ROLES.includes(req.user?.role);
    const hoursNum = hours != null && hours !== '' ? Number(hours) : 0;
    const reimbNum =
      reimbursementAmount != null && reimbursementAmount !== ''
        ? Number(reimbursementAmount)
        : 0;

    if (!allowNegative && (hoursNum < 0 || reimbNum < 0)) {
      return res.status(403).json({
        message: 'Only admins can enter negative hours or reimbursement corrections.',
      });
    }

    const result = await createDailyEntry({
      workerId,
      jobSiteId,
      payPeriodId,
      payCode,
      paychexComponentId,
      dateWorked,
      hours,
      reimbursementAmount,
      enteredBy: req.user.userId,
      allowNegative,
    });

    if (result.split) {
      return res.status(201).json({
        success: true,
        split: true,
        message: result.message,
        entries: result.entries.map((item) => mapDailyRowToLegacyShape(item.daily)),
      });
    }

    const status = result.correction ? 200 : 201;
    res.status(status).json({
      success: true,
      correction: Boolean(result.correction),
      deleted: Boolean(result.deleted),
      message: result.message,
      entry: mapDailyRowToLegacyShape(result.daily),
    });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({
        message:
          'An entry already exists for this worker, job site, pay code, and date.',
      });
    }
    const status = error.statusCode || 500;
    return res.status(status).json({ message: error.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const { payPeriodId, workerId, date } = req.query;
    let sql = `
      SELECT
        d.id,
        d.worker_id,
        d.job_site_id,
        d.date_worked AS entry_date,
        d.hours_worked AS hours,
        d.pay_code,
        d.paychex_component_id,
        d.component_name,
        d.component_rate,
        d.reimbursement_amount,
        d.pay_period_id,
        d.pay_period_end_date,
        d.labor_classification_id,
        d.week_number,
        d.entered_by,
        d.created_at,
        w.first_name AS worker_first_name,
        w.last_name AS worker_last_name,
        js.name AS job_site_name
      FROM daily_time_entries d
      JOIN workers w ON d.worker_id = w.id
      LEFT JOIN job_sites js ON d.job_site_id = js.id
      WHERE 1=1
    `;
    const params = [];

    if (payPeriodId) {
      params.push(payPeriodId);
      sql += ` AND d.pay_period_id = $${params.length}`;
    }
    if (workerId) {
      params.push(workerId);
      sql += ` AND d.worker_id = $${params.length}`;
    }
    if (date) {
      params.push(date);
      sql += ` AND d.date_worked = $${params.length}`;
    }

    sql += ' ORDER BY d.date_worked DESC, w.last_name, w.first_name';

    const result = await query(sql, params);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

async function updateEntry(req, res) {
  try {
    const updated = await updateDailyEntry(req.params.id, {
      hours: req.body.hours,
      reimbursementAmount: req.body.reimbursementAmount,
    });
    res.json(mapDailyRowToLegacyShape(updated));
  } catch (error) {
    const status = error instanceof DailyEntryError ? error.statusCode : 500;
    res.status(status).json({ message: error.message });
  }
}

router.put(
  '/:id',
  requireRole('system_admin', 'payroll_admin'),
  requireGlobalEditLock,
  updateEntry
);
router.patch(
  '/:id',
  requireRole('system_admin', 'payroll_admin'),
  requireGlobalEditLock,
  updateEntry
);

router.delete(
  '/:id',
  requireRole('system_admin', 'payroll_admin'),
  requireGlobalEditLock,
  async (req, res) => {
    try {
      await deleteDailyEntry(req.params.id);
      res.json({ message: 'Entry deleted' });
    } catch (error) {
      const status = error instanceof DailyEntryError ? error.statusCode : 500;
      res.status(status).json({ message: error.message });
    }
  }
);

module.exports = router;
module.exports.assertEntryDateAllowedForRole = assertEntryDateAllowedForRole;
module.exports.ADMIN_ROLES = ADMIN_ROLES;
