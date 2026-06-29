const express = require('express');
const { query } = require('../db');

const router = express.Router();

async function getCurrentOpenPayPeriod() {
  const result = await query(
    `SELECT * FROM pay_periods
     WHERE status = 'OPEN'
     ORDER BY start_date DESC
     LIMIT 1`
  );
  return result.rows[0] || null;
}

function normalizeDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return value.toISOString().split('T')[0];
  }
  return String(value).split('T')[0];
}

function determineWeekNumber(entryDate, payPeriod) {
  const date = normalizeDate(entryDate);
  const week1Start = normalizeDate(payPeriod.week1_start);
  const week1End = normalizeDate(payPeriod.week1_end);
  const week2Start = normalizeDate(payPeriod.week2_start);
  const week2End = normalizeDate(payPeriod.week2_end);

  if (date >= week1Start && date <= week1End) {
    return 1;
  }
  if (date >= week2Start && date <= week2End) {
    return 2;
  }
  return null;
}

router.post('/', async (req, res) => {
  try {
    const {
      workerId,
      jobSiteId,
      paychexComponentId,
      componentName,
      componentRate,
      hours,
      reimbursementAmount,
      entryDate,
    } = req.body;

    const payPeriod = await getCurrentOpenPayPeriod();
    if (!payPeriod) {
      return res.status(400).json({ message: 'No open pay period found' });
    }

    const weekNumber = determineWeekNumber(entryDate, payPeriod);
    if (!weekNumber) {
      return res.status(400).json({ message: 'Entry date does not fall within the current pay period' });
    }

    const result = await query(
      `INSERT INTO time_entries (
         worker_id, job_site_id, pay_period_id, paychex_component_id,
         component_name, component_rate, hours, reimbursement_amount,
         entry_date, week_number, entered_by
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        workerId,
        jobSiteId,
        payPeriod.id,
        paychexComponentId,
        componentName,
        componentRate ?? null,
        hours,
        reimbursementAmount ?? 0,
        entryDate,
        weekNumber,
        req.user.userId,
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({
        message: 'An entry already exists for this worker, job site, component, and date',
      });
    }
    res.status(500).json({ message: error.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const { payPeriodId, workerId, date } = req.query;
    let sql = `
      SELECT
        te.*,
        w.first_name AS worker_first_name,
        w.last_name AS worker_last_name,
        js.name AS job_site_name
      FROM time_entries te
      JOIN workers w ON te.worker_id = w.id
      JOIN job_sites js ON te.job_site_id = js.id
      WHERE 1=1
    `;
    const params = [];

    if (payPeriodId) {
      params.push(payPeriodId);
      sql += ` AND te.pay_period_id = $${params.length}`;
    }
    if (workerId) {
      params.push(workerId);
      sql += ` AND te.worker_id = $${params.length}`;
    }
    if (date) {
      params.push(date);
      sql += ` AND te.entry_date = $${params.length}`;
    }

    sql += ' ORDER BY te.entry_date DESC, w.last_name, w.first_name';

    const result = await query(sql, params);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { hours, reimbursementAmount } = req.body;

    const entryResult = await query(
      `SELECT te.*, pp.status AS pay_period_status
       FROM time_entries te
       JOIN pay_periods pp ON te.pay_period_id = pp.id
       WHERE te.id = $1`,
      [req.params.id]
    );

    if (entryResult.rows.length === 0) {
      return res.status(404).json({ message: 'Entry not found' });
    }

    const entry = entryResult.rows[0];
    if (entry.pay_period_status !== 'OPEN') {
      return res.status(400).json({ message: 'Pay period is not open for edits' });
    }

    const result = await query(
      `UPDATE time_entries
       SET hours = COALESCE($1, hours),
           reimbursement_amount = COALESCE($2, reimbursement_amount)
       WHERE id = $3
       RETURNING *`,
      [hours ?? null, reimbursementAmount ?? null, req.params.id]
    );

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const entryResult = await query(
      `SELECT te.*, pp.status AS pay_period_status
       FROM time_entries te
       JOIN pay_periods pp ON te.pay_period_id = pp.id
       WHERE te.id = $1`,
      [req.params.id]
    );

    if (entryResult.rows.length === 0) {
      return res.status(404).json({ message: 'Entry not found' });
    }

    const entry = entryResult.rows[0];
    if (entry.pay_period_status !== 'OPEN') {
      return res.status(400).json({ message: 'Pay period is not open for edits' });
    }

    await query('DELETE FROM time_entries WHERE id = $1', [req.params.id]);
    res.json({ message: 'Entry deleted' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
