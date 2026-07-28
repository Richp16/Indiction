const { pool } = require('../db');
const { resolveEntryPayFields, getWorkerWeeklyHours } = require('./entryPayCode');
const { isHoursPayCode } = require('../config/paychex');
const {
  mapPayCodeToPaychexComponent,
  mapPaychexComponentToPayCode,
  splitHoursByPayCode,
} = require('../config/payCodeMapping');
const {
  determineWeekNumber,
  resolvePayPeriodForDate,
  normalizeDate,
} = require('./payPeriodResolver');

const OT_WEEKLY_CAP = 40;

class DailyEntryError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

async function upsertAggregatedTimeEntry(client, {
  workerId,
  jobSiteId,
  payPeriodId,
  payPeriodEndDate,
  payCode,
  componentName,
  componentRate,
  hoursDelta,
  reimbursementDelta,
  laborClassificationId,
  enteredBy,
}) {
  const paychexComponentId = mapPayCodeToPaychexComponent(payCode);

  const result = await client.query(
    `INSERT INTO time_entries (
       worker_id,
       job_site_id,
       pay_period_id,
       pay_period_end_date,
       paychex_component_id,
       component_name,
       component_rate,
       hours,
       reimbursement_amount,
       labor_classification_id,
       entered_by
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (worker_id, job_site_id, pay_period_id, paychex_component_id)
     DO UPDATE SET
       hours = time_entries.hours + EXCLUDED.hours,
       reimbursement_amount = time_entries.reimbursement_amount + EXCLUDED.reimbursement_amount,
       component_rate = COALESCE(EXCLUDED.component_rate, time_entries.component_rate),
       labor_classification_id = COALESCE(EXCLUDED.labor_classification_id, time_entries.labor_classification_id),
       updated_at = now()
     RETURNING *`,
    [
      workerId,
      jobSiteId,
      payPeriodId,
      payPeriodEndDate,
      paychexComponentId,
      componentName,
      componentRate,
      hoursDelta,
      reimbursementDelta,
      laborClassificationId || null,
      enteredBy || null,
    ]
  );

  return result.rows[0];
}

async function insertDailyRow(client, {
  workerId,
  jobSiteId,
  dateWorked,
  payCode,
  hours,
  reimbursementAmount,
  payPeriodId,
  payPeriodEndDate,
  componentName,
  componentRate,
  laborClassificationId,
  weekNumber,
  enteredBy,
}) {
  const hourSplit = splitHoursByPayCode(payCode, hours);
  const paychexComponentId = payCode;

  const result = await client.query(
    `INSERT INTO daily_time_entries (
       worker_id,
       job_site_id,
       date_worked,
       hours_worked,
       regular_hours,
       overtime_hours,
       doubletime_hours,
       pay_period_id,
       pay_period_end_date,
       pay_code,
       paychex_component_id,
       component_name,
       component_rate,
       reimbursement_amount,
       labor_classification_id,
       week_number,
       entered_by
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
     RETURNING *`,
    [
      workerId,
      jobSiteId,
      dateWorked,
      hours,
      hourSplit.regular_hours,
      hourSplit.overtime_hours,
      hourSplit.doubletime_hours,
      payPeriodId,
      payPeriodEndDate,
      payCode,
      paychexComponentId,
      componentName,
      componentRate,
      reimbursementAmount || 0,
      laborClassificationId || null,
      weekNumber,
      enteredBy || null,
    ]
  );

  return result.rows[0];
}

async function createDailyEntryInTransaction(client, payload) {
  const {
    workerId,
    jobSiteId,
    payCode,
    dateWorked: rawDateWorked,
    hours,
    reimbursementAmount,
    payPeriodId: bodyPayPeriodId,
    enteredBy,
    paychexComponentId,
  } = payload;

  const dateWorked = normalizeDate(rawDateWorked);
  const normalizedJobSiteId = jobSiteId || null;

  const payPeriod = await resolvePayPeriodForDate(dateWorked, bodyPayPeriodId);
  const weekNumber = determineWeekNumber(dateWorked, payPeriod);
  if (!weekNumber) {
    throw new DailyEntryError('Entry date does not fall within the pay period weeks');
  }

  const resolved = await resolveEntryPayFields({
    workerId,
    jobSiteId: normalizedJobSiteId,
    payCode,
    paychexComponentId: isHoursPayCode(payCode) ? undefined : paychexComponentId,
    hours,
    reimbursementAmount,
  });

  const baseArgs = {
    workerId,
    jobSiteId: normalizedJobSiteId,
    dateWorked,
    payPeriodId: payPeriod.id,
    payPeriodEndDate: payPeriod.pay_period_end_date,
    weekNumber,
    enteredBy,
  };

  if (resolved.paychexComponentId === 'REGULAR') {
    const workedSoFar = await getWorkerWeeklyHours(workerId, dateWorked, payPeriod.id);
    const remainingRegular = Math.max(0, OT_WEEKLY_CAP - workedSoFar);
    const requestedHours = resolved.hours;

    if (workedSoFar >= OT_WEEKLY_CAP) {
      return createSingleDailyEntry(client, {
        ...baseArgs,
        payCode: 'OT',
        hours: requestedHours,
        componentName: 'Overtime',
        componentRate: resolved.componentRate,
        reimbursementAmount: 0,
      });
    }

    if (requestedHours > remainingRegular) {
      const regularHours = remainingRegular;
      const otHours = requestedHours - remainingRegular;
      const entries = [];

      if (regularHours > 0) {
        entries.push(
          await createSingleDailyEntry(client, {
            ...baseArgs,
            payCode: 'REGULAR',
            hours: regularHours,
            componentName: resolved.componentName,
            componentRate: resolved.componentRate,
            reimbursementAmount: 0,
          })
        );
      }

      if (otHours > 0) {
        entries.push(
          await createSingleDailyEntry(client, {
            ...baseArgs,
            payCode: 'OT',
            hours: otHours,
            componentName: 'Overtime',
            componentRate: resolved.componentRate,
            reimbursementAmount: 0,
          })
        );
      }

      return {
        split: true,
        message: `Hours split: ${regularHours} regular + ${otHours} OT (worker reached 40-hour weekly limit).`,
        entries,
        dailyEntries: entries.map((e) => e.daily),
        aggregates: entries.map((e) => e.aggregate),
      };
    }
  }

  return createSingleDailyEntry(client, {
    ...baseArgs,
    payCode: resolved.paychexComponentId,
    hours: resolved.hours,
    componentName: resolved.componentName,
    componentRate: resolved.componentRate,
    reimbursementAmount: resolved.reimbursementAmount,
  });
}

async function createSingleDailyEntry(client, args) {
  const {
    workerId,
    jobSiteId,
    dateWorked,
    payCode,
    hours,
    componentName,
    componentRate,
    reimbursementAmount,
    payPeriodId,
    payPeriodEndDate,
    laborClassificationId,
    weekNumber,
    enteredBy,
  } = args;

  const dupCheck = await client.query(
    `SELECT id FROM daily_time_entries
     WHERE worker_id = $1
       AND job_site_id IS NOT DISTINCT FROM $2
       AND date_worked = $3
       AND pay_period_id = $4
       AND paychex_component_id = $5`,
    [workerId, jobSiteId, dateWorked, payPeriodId, payCode]
  );

  if (dupCheck.rows.length > 0) {
    const error = new DailyEntryError(
      'An entry already exists for this worker, job site, pay code, and date.',
      409
    );
    throw error;
  }

  const daily = await insertDailyRow(client, {
    workerId,
    jobSiteId,
    dateWorked,
    payCode,
    hours,
    reimbursementAmount,
    payPeriodId,
    payPeriodEndDate,
    componentName,
    componentRate,
    laborClassificationId,
    weekNumber,
    enteredBy,
  });

  const aggregate = await upsertAggregatedTimeEntry(client, {
    workerId,
    jobSiteId,
    payPeriodId,
    payPeriodEndDate,
    payCode,
    componentName,
    componentRate,
    hoursDelta: hours,
    reimbursementDelta: reimbursementAmount || 0,
    laborClassificationId,
    enteredBy,
  });

  return { daily, aggregate, split: false };
}

async function createDailyEntry(payload) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await createDailyEntryInTransaction(client, payload);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function recalcAggregatedTimeEntry(client, {
  workerId,
  jobSiteId,
  payPeriodId,
  payCode,
}) {
  const paychexComponentId = mapPayCodeToPaychexComponent(payCode);

  const sumResult = await client.query(
    `SELECT
       COALESCE(SUM(hours_worked), 0) AS total_hours,
       COALESCE(SUM(reimbursement_amount), 0) AS total_reimbursement,
       MAX(component_name) AS component_name,
       MAX(component_rate) AS component_rate,
       MAX(labor_classification_id) AS labor_classification_id,
       MAX(pay_period_end_date) AS pay_period_end_date
     FROM daily_time_entries
     WHERE worker_id = $1
       AND job_site_id IS NOT DISTINCT FROM $2
       AND pay_period_id = $3
       AND pay_code = $4`,
    [workerId, jobSiteId, payPeriodId, payCode]
  );

  const totals = sumResult.rows[0];
  const totalHours = Number(totals.total_hours);
  const totalReimbursement = Number(totals.total_reimbursement);

  if (totalHours <= 0 && totalReimbursement <= 0) {
    await client.query(
      `DELETE FROM time_entries
       WHERE worker_id = $1
         AND job_site_id IS NOT DISTINCT FROM $2
         AND pay_period_id = $3
         AND paychex_component_id = $4`,
      [workerId, jobSiteId, payPeriodId, paychexComponentId]
    );
    return null;
  }

  const result = await client.query(
    `INSERT INTO time_entries (
       worker_id,
       job_site_id,
       pay_period_id,
       pay_period_end_date,
       paychex_component_id,
       component_name,
       component_rate,
       hours,
       reimbursement_amount,
       labor_classification_id
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (worker_id, job_site_id, pay_period_id, paychex_component_id)
     DO UPDATE SET
       hours = EXCLUDED.hours,
       reimbursement_amount = EXCLUDED.reimbursement_amount,
       component_name = EXCLUDED.component_name,
       component_rate = EXCLUDED.component_rate,
       labor_classification_id = EXCLUDED.labor_classification_id,
       pay_period_end_date = EXCLUDED.pay_period_end_date,
       updated_at = now()
     RETURNING *`,
    [
      workerId,
      jobSiteId,
      payPeriodId,
      totals.pay_period_end_date,
      paychexComponentId,
      totals.component_name,
      totals.component_rate,
      totalHours,
      totalReimbursement,
      totals.labor_classification_id,
    ]
  );

  return result.rows[0];
}

async function updateDailyEntry(dailyEntryId, { hours, reimbursementAmount }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query(
      `SELECT d.*, pp.status AS pay_period_status
       FROM daily_time_entries d
       JOIN pay_periods pp ON d.pay_period_id = pp.id
       WHERE d.id = $1`,
      [dailyEntryId]
    );

    if (existing.rows.length === 0) {
      throw new DailyEntryError('Entry not found', 404);
    }

    const entry = existing.rows[0];
    if (entry.pay_period_status !== 'OPEN') {
      throw new DailyEntryError('Pay period is not open for edits', 400);
    }

    const newHours = hours != null ? Number(hours) : Number(entry.hours_worked);
    const newReimbursement =
      reimbursementAmount != null ? Number(reimbursementAmount) : Number(entry.reimbursement_amount);
    const hourSplit = splitHoursByPayCode(entry.pay_code, newHours);

    const updated = await client.query(
      `UPDATE daily_time_entries
       SET hours_worked = $1,
           regular_hours = $2,
           overtime_hours = $3,
           doubletime_hours = $4,
           reimbursement_amount = $5
       WHERE id = $6
       RETURNING *`,
      [
        newHours,
        hourSplit.regular_hours,
        hourSplit.overtime_hours,
        hourSplit.doubletime_hours,
        newReimbursement,
        dailyEntryId,
      ]
    );

    await recalcAggregatedTimeEntry(client, {
      workerId: entry.worker_id,
      jobSiteId: entry.job_site_id,
      payPeriodId: entry.pay_period_id,
      payCode: entry.pay_code,
    });

    await client.query('COMMIT');
    return updated.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function deleteDailyEntry(dailyEntryId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query(
      `SELECT d.*, pp.status AS pay_period_status
       FROM daily_time_entries d
       JOIN pay_periods pp ON d.pay_period_id = pp.id
       WHERE d.id = $1`,
      [dailyEntryId]
    );

    if (existing.rows.length === 0) {
      throw new DailyEntryError('Entry not found', 404);
    }

    const entry = existing.rows[0];
    if (entry.pay_period_status !== 'OPEN') {
      throw new DailyEntryError('Pay period is not open for edits', 400);
    }

    await client.query('DELETE FROM daily_time_entries WHERE id = $1', [dailyEntryId]);

    await recalcAggregatedTimeEntry(client, {
      workerId: entry.worker_id,
      jobSiteId: entry.job_site_id,
      payPeriodId: entry.pay_period_id,
      payCode: entry.pay_code,
    });

    await client.query('COMMIT');
    return { deleted: true };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  DailyEntryError,
  createDailyEntry,
  updateDailyEntry,
  deleteDailyEntry,
  recalcAggregatedTimeEntry,
  mapPaychexComponentToPayCode,
};
