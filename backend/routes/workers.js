const express = require('express');
const { query } = require('../db');
const { isReimbursementComponentName } = require('../config/paychex');
const { getWeekBounds } = require('../services/entryPayCode');
const { requireRole } = require('../middleware/roleGuard');
const { requireGlobalEditLock } = require('../middleware/editLock');

const router = express.Router();

const OT_WEEKLY_CAP = 40;

/**
 * Set workers.labor_classification_id. Works for active and terminated workers.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {{ classificationId: unknown }} options
 */
async function updateWorkerLaborClassification(req, res, { classificationId }) {
  let laborClassificationId = null;

  if (classificationId != null && classificationId !== '') {
    const parsed = Number(classificationId);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return res.status(400).json({
        message: 'laborClassificationId must be a positive integer or null',
      });
    }

    const classificationResult = await query(
      `SELECT id, name FROM labor_classifications WHERE id = $1`,
      [parsed]
    );
    if (classificationResult.rows.length === 0) {
      return res.status(404).json({ message: 'Classification not found' });
    }
    laborClassificationId = parsed;
  }

  // No is_active filter — terminated workers must be assignable for WH-347.
  const result = await query(
    `UPDATE workers
     SET labor_classification_id = $1
     WHERE id = $2
     RETURNING
       id,
       employee_code,
       first_name,
       last_name,
       is_active,
       labor_classification_id`,
    [laborClassificationId, req.params.id]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ message: 'Worker not found' });
  }

  const worker = result.rows[0];
  let classificationName = null;
  if (worker.labor_classification_id) {
    const nameResult = await query(
      `SELECT name FROM labor_classifications WHERE id = $1`,
      [worker.labor_classification_id]
    );
    classificationName = nameResult.rows[0]?.name || null;
  }

  return res.json({
    id: worker.id,
    employeeCode: worker.employee_code,
    firstName: worker.first_name,
    lastName: worker.last_name,
    isActive: worker.is_active,
    laborClassificationId: worker.labor_classification_id,
    laborClassificationName: classificationName,
    classification: classificationName
      ? { id: worker.labor_classification_id, name: classificationName }
      : null,
  });
}

router.get('/assignments', requireRole('system_admin', 'payroll_admin'), async (_req, res) => {
  try {
    const result = await query(
      `SELECT
         w.id,
         w.employee_code,
         w.first_name,
         w.last_name,
         w.labor_classification_id,
         lc.name AS labor_classification_name
       FROM workers w
       LEFT JOIN labor_classifications lc ON w.labor_classification_id = lc.id
       WHERE w.is_active = true
       ORDER BY w.last_name, w.first_name`
    );
    res.json(
      result.rows.map((row) => ({
        id: row.id,
        employeeCode: row.employee_code,
        firstName: row.first_name,
        lastName: row.last_name,
        laborClassificationId: row.labor_classification_id,
        laborClassificationName: row.labor_classification_name || null,
      }))
    );
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.patch(
  '/:id/classification',
  requireRole('system_admin', 'payroll_admin'),
  requireGlobalEditLock,
  async (req, res) => {
    try {
      await updateWorkerLaborClassification(req, res, {
        classificationId:
          req.body?.classificationId ?? req.body?.laborClassificationId ?? null,
      });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  }
);

router.patch(
  '/:id/labor-classification',
  requireRole('system_admin', 'payroll_admin'),
  requireGlobalEditLock,
  async (req, res) => {
    try {
      await updateWorkerLaborClassification(req, res, {
        classificationId:
          req.body?.laborClassificationId ?? req.body?.classificationId ?? null,
      });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  }
);

router.get('/', async (req, res) => {
  try {
    const { search } = req.query;
    let sql = `
      SELECT id, employee_code, first_name, last_name, is_active, standard_rate
      FROM workers
      WHERE is_active = true
        AND standard_rate IS NOT NULL
    `;
    const params = [];

    if (search) {
      params.push(`%${search}%`);
      sql += ` AND (first_name || ' ' || last_name) ILIKE $${params.length}`;
    }

    sql += ' ORDER BY last_name, first_name';

    const result = await query(sql, params);
    const workers = result.rows.map((row) => ({
      id: row.id,
      employeeCode: row.employee_code,
      firstName: row.first_name,
      lastName: row.last_name,
      isActive: row.is_active,
      standardRate: row.standard_rate != null ? parseFloat(row.standard_rate) : null,
    }));

    res.json(workers);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.get('/:id/weekly-hours', async (req, res) => {
  try {
    const { date, payPeriodId } = req.query;

    const workerResult = await query(
      `SELECT id FROM workers
       WHERE id = $1 AND is_active = true AND standard_rate IS NOT NULL`,
      [req.params.id]
    );

    if (workerResult.rows.length === 0) {
      return res.status(404).json({ message: 'Worker not found or not eligible for payroll' });
    }

    const entryDate =
      date && String(date).trim()
        ? String(date).split('T')[0]
        : new Date().toISOString().split('T')[0];

    const { resolvePayPeriodForDate } = require('../services/payPeriodResolver');
    let resolvedPeriodId = payPeriodId || null;
    try {
      const period = await resolvePayPeriodForDate(entryDate, payPeriodId || null);
      resolvedPeriodId = period.id;
    } catch (error) {
      const status = error.statusCode || 400;
      return res.status(status).json({ message: error.message });
    }

    const { sunday, saturday } = getWeekBounds(entryDate);

    const result = await query(
      `SELECT
         pay_code,
         COALESCE(SUM(hours_worked), 0) AS total_hours
       FROM daily_time_entries
       WHERE worker_id = $1
         AND pay_period_id = $2
         AND date_worked >= $3
         AND date_worked <= $4
         AND pay_code IN ('REGULAR', 'OT')
       GROUP BY pay_code`,
      [req.params.id, resolvedPeriodId, sunday, saturday]
    );

    let regularHours = 0;
    let otHours = 0;
    for (const row of result.rows) {
      const hours = Number(row.total_hours) || 0;
      if (row.pay_code === 'REGULAR') {
        regularHours = hours;
      } else if (row.pay_code === 'OT') {
        otHours = hours;
      }
    }

    const totalHours = regularHours + otHours;
    const remainingBeforeOT = Math.max(0, OT_WEEKLY_CAP - regularHours - otHours);

    res.json({
      weekStart: sunday,
      weekEnd: saturday,
      regularHours,
      otHours,
      totalHours,
      remainingBeforeOT,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.get('/:id/pay-components', async (req, res) => {
  try {
    const workerResult = await query(
      `SELECT id FROM workers
       WHERE id = $1 AND is_active = true AND standard_rate IS NOT NULL`,
      [req.params.id]
    );

    if (workerResult.rows.length === 0) {
      return res.status(404).json({ message: 'Worker not found or not eligible for payroll' });
    }

    const result = await query(
      `SELECT paychex_component_id, name, rate
       FROM worker_pay_components
       WHERE worker_id = $1
       ORDER BY name`,
      [req.params.id]
    );

    const components = result.rows
      .filter((row) => isReimbursementComponentName(row.name))
      .map((row) => ({
      paychexComponentId: row.paychex_component_id,
      name: row.name,
      rate: row.rate != null ? parseFloat(row.rate) : null,
      type: 'REIMBURSEMENT',
    }));

    res.json(components);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

/**
 * Cached Paychex recurring reimbursements for Daily Entry admin warning.
 * Reads local DB only — does not call Paychex live.
 */
router.get(
  '/:id/recurring-reimbursements',
  requireRole('system_admin', 'payroll_admin'),
  async (req, res) => {
    try {
      const workerResult = await query(`SELECT id FROM workers WHERE id = $1`, [
        req.params.id,
      ]);
      if (workerResult.rows.length === 0) {
        return res.status(404).json({ message: 'Worker not found' });
      }

      const result = await query(
        `SELECT
           amount,
           paychex_pay_component_id,
           component_name,
           recurring,
           last_synced_at
         FROM worker_recurring_reimbursements
         WHERE worker_id = $1
           AND recurring = true
         ORDER BY component_name NULLS LAST, paychex_pay_component_id`,
        [req.params.id]
      );

      const items = result.rows.map((row) => ({
        amount: Number(row.amount) || 0,
        paychexPayComponentId: row.paychex_pay_component_id,
        componentName: row.component_name,
        recurring: row.recurring,
        lastSyncedAt: row.last_synced_at,
      }));

      const totalAmount = items.reduce((sum, item) => sum + item.amount, 0);

      res.json({ items, totalAmount });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  }
);

router.patch('/:id', requireRole('system_admin', 'payroll_admin'), requireGlobalEditLock, async (req, res) => {
  try {
    const { worker_type } = req.body;
    if (!['J', 'RA'].includes(worker_type)) {
      return res.status(400).json({ message: 'worker_type must be J or RA' });
    }
    const result = await query(
      `UPDATE workers
       SET worker_type = $1
       WHERE id = $2
       RETURNING id, worker_type`,
      [worker_type, req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Worker not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
