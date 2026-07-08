const express = require('express');
const { query } = require('../db');
const { requireRole } = require('../middleware/roleGuard');
const { resolveEntryPayFields, getWorkerWeeklyHours } = require('../services/entryPayCode');
const { isHoursPayCode } = require('../config/paychex');

const router = express.Router();

async function getCurrentOpenPayPeriod() {
  let result = await query(
    `SELECT
       id,
       paychex_period_id,
       start_date::text,
       end_date::text,
       submit_by_date::text,
       pay_date::text,
       status,
       week1_start::text,
       week1_end::text,
       week2_start::text,
       week2_end::text
     FROM pay_periods
     WHERE status = 'OPEN'
       AND start_date <= CURRENT_DATE
       AND end_date >= CURRENT_DATE
     ORDER BY start_date DESC
     LIMIT 1`
  );

  if (result.rows.length > 0) {
    return result.rows[0];
  }

  result = await query(
    `SELECT
       id,
       paychex_period_id,
       start_date::text,
       end_date::text,
       submit_by_date::text,
       pay_date::text,
       status,
       week1_start::text,
       week1_end::text,
       week2_start::text,
       week2_end::text
     FROM pay_periods
     WHERE status = 'OPEN'
       AND start_date > CURRENT_DATE
     ORDER BY start_date ASC
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

function payTypeConstraintIncludesPayComponent(constraint) {
  if (!constraint) return false;
  const name = constraint.toLowerCase();
  return (
    name.includes('paychex_component') ||
    name.includes('component_unique') ||
    name.includes('paycode') ||
    name.includes('pay_code')
  );
}

const OT_WEEKLY_CAP = 40;

router.post('/', async (req, res) => {
  try {
    const {
      workerId,
      jobSiteId,
      payPeriodId: bodyPayPeriodId,
      paychexComponentId,
      payCode,
      entryDate,
      hours,
      reimbursementAmount,
    } = req.body;

    const normalizedJobSiteId = jobSiteId || null;

    let payPeriod;
    let payPeriodId = bodyPayPeriodId;

    if (payPeriodId) {
      const periodResult = await query(
        `SELECT
           id,
           week1_start::text,
           week1_end::text,
           week2_start::text,
           week2_end::text
         FROM pay_periods
         WHERE id = $1`,
        [payPeriodId]
      );
      if (periodResult.rows.length === 0) {
        return res.status(400).json({ message: 'Pay period not found' });
      }
      payPeriod = periodResult.rows[0];
    } else {
      payPeriod = await getCurrentOpenPayPeriod();
      if (!payPeriod) {
        return res.status(400).json({ message: 'No open pay period found' });
      }
      payPeriodId = payPeriod.id;
    }

    const weekNumber = determineWeekNumber(entryDate, payPeriod);
    if (!weekNumber) {
      return res.status(400).json({ message: 'Entry date does not fall within the current pay period' });
    }

    const resolved = await resolveEntryPayFields({
      workerId,
      payCode,
      paychexComponentId: isHoursPayCode(payCode) ? undefined : paychexComponentId,
      hours,
      reimbursementAmount,
    });

    if (resolved.paychexComponentId === 'REGULAR') {
      const workedSoFar = await getWorkerWeeklyHours(workerId, entryDate, payPeriodId);
      const remainingRegular = Math.max(0, OT_WEEKLY_CAP - workedSoFar);
      const requestedHours = resolved.hours;

      if (workedSoFar >= OT_WEEKLY_CAP) {
        resolved.paychexComponentId = 'OT';
        resolved.componentName = 'Overtime';
      } else if (requestedHours > remainingRegular) {
        const regularHours = remainingRegular;
        const otHours = requestedHours - remainingRegular;

        const regularDupCheck = await query(
          `SELECT id FROM time_entries
           WHERE worker_id = $1 AND job_site_id = $2 AND entry_date = $3
             AND pay_period_id = $4 AND paychex_component_id = 'REGULAR'`,
          [workerId, normalizedJobSiteId, entryDate, payPeriodId]
        );

        const otDupCheck = await query(
          `SELECT id FROM time_entries
           WHERE worker_id = $1 AND job_site_id = $2 AND entry_date = $3
             AND pay_period_id = $4 AND paychex_component_id = 'OT'`,
          [workerId, normalizedJobSiteId, entryDate, payPeriodId]
        );

        if (regularDupCheck.rows.length > 0 && otDupCheck.rows.length > 0) {
          return res.status(409).json({
            message:
              'Hours already logged for this worker, job site, and date for both Regular and Overtime. ' +
              'Edit existing entries in the Summary tab to adjust hours.',
          });
        }

        let regularEntry = null;
        if (regularHours > 0 && regularDupCheck.rows.length === 0) {
          const regularResult = await query(
            `INSERT INTO time_entries (
               worker_id, job_site_id, pay_period_id, paychex_component_id,
               component_name, component_rate, entry_date, hours,
               reimbursement_amount, week_number, entered_by
             ) VALUES ($1, $2, $3, 'REGULAR', $4, $5, $6, $7, 0, $8, $9)
             RETURNING *`,
            [
              workerId,
              normalizedJobSiteId,
              payPeriodId,
              resolved.componentName,
              resolved.componentRate,
              entryDate,
              regularHours,
              weekNumber,
              req.user.userId,
            ]
          );
          regularEntry = regularResult.rows[0];
        }

        const otHoursToInsert =
          regularDupCheck.rows.length > 0 ? requestedHours : otHours;

        let otEntry = null;
        if (otHoursToInsert > 0 && otDupCheck.rows.length === 0) {
          const otResult = await query(
            `INSERT INTO time_entries (
               worker_id, job_site_id, pay_period_id, paychex_component_id,
               component_name, component_rate, entry_date, hours,
               reimbursement_amount, week_number, entered_by
             ) VALUES ($1, $2, $3, 'OT', 'Overtime', $4, $5, $6, 0, $7, $8)
             RETURNING *`,
            [
              workerId,
              normalizedJobSiteId,
              payPeriodId,
              resolved.componentRate,
              entryDate,
              otHoursToInsert,
              weekNumber,
              req.user.userId,
            ]
          );
          otEntry = otResult.rows[0];
        }

        const loggedRegularHours = regularEntry ? regularHours : 0;
        const loggedOtHours = otEntry ? otHoursToInsert : 0;

        return res.status(201).json({
          success: true,
          split: true,
          message: `Hours split: ${loggedRegularHours} regular + ${loggedOtHours} OT (worker reached 40-hour weekly limit).`,
          entries: [regularEntry, otEntry].filter(Boolean),
        });
      }
    }

    const duplicateCheck = await query(
      `SELECT id FROM time_entries
       WHERE worker_id = $1
         AND job_site_id = $2
         AND entry_date = $3
         AND pay_period_id = $4
         AND paychex_component_id = $5`,
      [
        workerId,
        normalizedJobSiteId,
        entryDate,
        payPeriodId,
        resolved.paychexComponentId,
      ]
    );

    if (duplicateCheck.rows.length > 0) {
      return res.status(409).json({
        message:
          'An entry already exists for this worker, job site, pay code, and date. ' +
          'To add different pay types (e.g., Regular + Overtime), submit a separate entry with a different pay code.',
      });
    }

    // NOTE: DB unique constraint must include paychex_component_id (logical pay type key).
    // See db/migrations/001_add_pay_code_to_time_entries_unique_constraint.sql
    const result = await query(
      `INSERT INTO time_entries (
         worker_id, job_site_id, pay_period_id, paychex_component_id, component_name,
         component_rate, entry_date, hours, reimbursement_amount, week_number, entered_by
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        workerId,
        normalizedJobSiteId,
        payPeriodId,
        resolved.paychexComponentId,
        resolved.componentName,
        resolved.componentRate,
        entryDate,
        resolved.hours,
        resolved.reimbursementAmount,
        weekNumber,
        req.user.userId,
      ]
    );

    res.status(201).json({ success: true, entry: result.rows[0] });
  } catch (error) {
    if (error.code === '23505') {
      if (!payTypeConstraintIncludesPayComponent(error.constraint)) {
        return res.status(409).json({
          error:
            'Duplicate entry detected. If you are trying to add a different pay type for this ' +
            'worker on the same day and job site, the database constraint needs to be updated ' +
            'to include paychex_component_id. Contact your administrator.',
        });
      }
      return res.status(409).json({
        message:
          'An entry already exists for this worker, job site, pay code, and date. ' +
          'To add different pay types (e.g., Regular + Overtime), submit a separate entry with a different pay code.',
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
        te.*,
        w.first_name AS worker_first_name,
        w.last_name AS worker_last_name,
        js.name AS job_site_name
      FROM time_entries te
      JOIN workers w ON te.worker_id = w.id
      LEFT JOIN job_sites js ON te.job_site_id = js.id
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

router.put('/:id', requireRole('system_admin', 'payroll_admin'), async (req, res) => {
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

router.delete('/:id', requireRole('system_admin', 'payroll_admin'), async (req, res) => {
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
