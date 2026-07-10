const express = require('express');
const { query } = require('../db');
const { requireRole } = require('../middleware/roleGuard');
const {
  createDailyEntry,
  updateDailyEntry,
  deleteDailyEntry,
  DailyEntryError,
} = require('../services/dailyEntryService');

const router = express.Router();

function mapDailyRowToLegacyShape(row) {
  if (!row) return row;
  return {
    ...row,
    entry_date: row.date_worked,
    hours: row.hours_worked,
    paychex_component_id: row.paychex_component_id,
  };
}

router.post('/', async (req, res) => {
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

    const result = await createDailyEntry({
      workerId,
      jobSiteId,
      payPeriodId,
      payCode,
      paychexComponentId,
      dateWorked: entry_date || entryDate,
      hours,
      reimbursementAmount,
      enteredBy: req.user.userId,
    });

    if (result.split) {
      return res.status(201).json({
        success: true,
        split: true,
        message: result.message,
        entries: result.entries.map((item) => mapDailyRowToLegacyShape(item.daily)),
      });
    }

    res.status(201).json({
      success: true,
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

router.put('/:id', requireRole('system_admin', 'payroll_admin'), updateEntry);
router.patch('/:id', requireRole('system_admin', 'payroll_admin'), updateEntry);

router.delete('/:id', requireRole('system_admin', 'payroll_admin'), async (req, res) => {
  try {
    await deleteDailyEntry(req.params.id);
    res.json({ message: 'Entry deleted' });
  } catch (error) {
    const status = error instanceof DailyEntryError ? error.statusCode : 500;
    res.status(status).json({ message: error.message });
  }
});

module.exports = router;
