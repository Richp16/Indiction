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
    allowNegative = false,
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
    allowNegative,
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

  // Negative corrections skip OT auto-split — insert as-is for the selected pay code.
  if (resolved.paychexComponentId === 'REGULAR' && resolved.hours > 0) {
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

async function applyDeltaToExistingDailyEntry(client, existingId, {
  hoursDelta,
  reimbursementDelta,
  componentName,
  componentRate,
  laborClassificationId,
  enteredBy,
}) {
  const existingResult = await client.query(
    'SELECT * FROM daily_time_entries WHERE id = $1 FOR UPDATE',
    [existingId]
  );
  const entry = existingResult.rows[0];
  if (!entry) {
    throw new DailyEntryError('Entry not found', 404);
  }

  const newHours = Number(entry.hours_worked) + Number(hoursDelta || 0);
  const newReimbursement =
    Number(entry.reimbursement_amount) + Number(reimbursementDelta || 0);

  if (newHours === 0 && newReimbursement === 0) {
    await client.query('DELETE FROM daily_time_entries WHERE id = $1', [existingId]);
    const aggregate = await recalcAggregatedTimeEntry(client, {
      workerId: entry.worker_id,
      jobSiteId: entry.job_site_id,
      payPeriodId: entry.pay_period_id,
      payCode: entry.pay_code,
    });
    return {
      daily: null,
      aggregate,
      split: false,
      correction: true,
      deleted: true,
      message: 'Correction applied; entry netted to zero and was removed.',
    };
  }

  const hourSplit = splitHoursByPayCode(entry.pay_code, newHours);
  const updated = await client.query(
    `UPDATE daily_time_entries
     SET hours_worked = $1,
         regular_hours = $2,
         overtime_hours = $3,
         doubletime_hours = $4,
         reimbursement_amount = $5,
         component_name = COALESCE($6, component_name),
         component_rate = COALESCE($7, component_rate),
         labor_classification_id = COALESCE($8, labor_classification_id)
     WHERE id = $9
     RETURNING *`,
    [
      newHours,
      hourSplit.regular_hours,
      hourSplit.overtime_hours,
      hourSplit.doubletime_hours,
      newReimbursement,
      componentName || null,
      componentRate ?? null,
      laborClassificationId || null,
      existingId,
    ]
  );

  const aggregate = await recalcAggregatedTimeEntry(client, {
    workerId: entry.worker_id,
    jobSiteId: entry.job_site_id,
    payPeriodId: entry.pay_period_id,
    payCode: entry.pay_code,
  });

  return {
    daily: updated.rows[0],
    aggregate,
    split: false,
    correction: true,
    message: 'Correction applied to existing entry.',
  };
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
    const hoursNum = Number(hours) || 0;
    const reimbNum = Number(reimbursementAmount) || 0;
    // Admin negative corrections adjust the existing row instead of inserting a conflict.
    if (hoursNum < 0 || reimbNum < 0) {
      return applyDeltaToExistingDailyEntry(client, dupCheck.rows[0].id, {
        hoursDelta: hoursNum,
        reimbursementDelta: reimbNum,
        componentName,
        componentRate,
        laborClassificationId,
        enteredBy,
      });
    }

    throw new DailyEntryError(
      'An entry already exists for this worker, job site, pay code, and date.',
      409
    );
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

  return {
    daily,
    aggregate,
    split: false,
    correction: hours < 0 || Number(reimbursementAmount) < 0,
    message:
      hours < 0 || Number(reimbursementAmount) < 0
        ? 'Correction entry saved.'
        : undefined,
  };
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

function wrapDailyEntryError(error) {
  if (error instanceof DailyEntryError) return error;
  if (error.code === '23505') {
    return new DailyEntryError(
      'An entry already exists for this worker, job site, pay code, and date.',
      409
    );
  }
  if (error.statusCode) {
    return new DailyEntryError(error.message, error.statusCode);
  }
  return error;
}

async function updateDailyEntry(dailyEntryId, { hours, reimbursementAmount, payCode }) {
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

    const nextPayCode =
      payCode != null && String(payCode).trim() !== ''
        ? String(payCode).trim()
        : entry.pay_code;
    const hoursProvided = hours != null && hours !== '';
    const reimbProvided = reimbursementAmount != null && reimbursementAmount !== '';
    const requestedHours = hoursProvided ? Number(hours) : Number(entry.hours_worked);
    const requestedReimb = reimbProvided
      ? Number(reimbursementAmount)
      : Number(entry.reimbursement_amount);

    let nextHours = requestedHours;
    let nextReimbursement = requestedReimb;
    let nextComponentName = entry.component_name;
    let nextComponentRate = entry.component_rate;
    let nextStoredPayCode = nextPayCode;

    if (isHoursPayCode(nextPayCode)) {
      const resolved = await resolveEntryPayFields({
        workerId: entry.worker_id,
        jobSiteId: entry.job_site_id,
        payCode: nextPayCode,
        hours: requestedHours,
        reimbursementAmount: 0,
        allowNegative: true,
      });
      nextStoredPayCode = resolved.paychexComponentId;
      nextHours = resolved.hours;
      nextReimbursement = 0;
      nextComponentName = resolved.componentName;
      nextComponentRate = resolved.componentRate;
    } else if (nextPayCode === 'DT') {
      if (!Number.isFinite(requestedHours) || requestedHours === 0) {
        throw new DailyEntryError('Hours must be a non-zero value', 400);
      }
      nextHours = requestedHours;
      nextReimbursement = 0;
      nextStoredPayCode = 'DT';
    } else {
      const resolved = await resolveEntryPayFields({
        workerId: entry.worker_id,
        jobSiteId: entry.job_site_id,
        payCode: nextPayCode,
        hours: 0,
        reimbursementAmount: requestedReimb,
        allowNegative: true,
      });
      nextStoredPayCode = resolved.paychexComponentId;
      nextHours = 0;
      nextReimbursement = resolved.reimbursementAmount;
      nextComponentName = resolved.componentName;
      nextComponentRate = resolved.componentRate;
    }

    const payCodeChanged = nextStoredPayCode !== entry.pay_code;
    if (payCodeChanged) {
      const dup = await client.query(
        `SELECT id FROM daily_time_entries
         WHERE worker_id = $1
           AND job_site_id IS NOT DISTINCT FROM $2
           AND date_worked = $3
           AND paychex_component_id = $4
           AND id <> $5`,
        [
          entry.worker_id,
          entry.job_site_id,
          entry.date_worked,
          nextStoredPayCode,
          dailyEntryId,
        ]
      );
      if (dup.rows.length > 0) {
        throw new DailyEntryError(
          'An entry already exists for this worker, job site, pay code, and date.',
          409
        );
      }
    }

    const hourSplit = splitHoursByPayCode(nextStoredPayCode, nextHours);
    const updated = await client.query(
      `UPDATE daily_time_entries
       SET hours_worked = $1,
           regular_hours = $2,
           overtime_hours = $3,
           doubletime_hours = $4,
           reimbursement_amount = $5,
           pay_code = $6,
           paychex_component_id = $7,
           component_name = $8,
           component_rate = $9
       WHERE id = $10
       RETURNING *`,
      [
        nextHours,
        hourSplit.regular_hours,
        hourSplit.overtime_hours,
        hourSplit.doubletime_hours,
        nextReimbursement,
        nextStoredPayCode,
        nextStoredPayCode,
        nextComponentName,
        nextComponentRate,
        dailyEntryId,
      ]
    );

    await recalcAggregatedTimeEntry(client, {
      workerId: entry.worker_id,
      jobSiteId: entry.job_site_id,
      payPeriodId: entry.pay_period_id,
      payCode: entry.pay_code,
    });

    if (payCodeChanged) {
      await recalcAggregatedTimeEntry(client, {
        workerId: entry.worker_id,
        jobSiteId: entry.job_site_id,
        payPeriodId: entry.pay_period_id,
        payCode: nextStoredPayCode,
      });
    }

    await client.query('COMMIT');
    return updated.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw wrapDailyEntryError(error);
  } finally {
    client.release();
  }
}

async function createBulkDailyEntries({
  workerIds,
  jobSiteId,
  payPeriodId,
  payCode,
  paychexComponentId,
  dateWorked,
  hours,
  reimbursementAmount,
  enteredBy,
  allowNegative = false,
}) {
  const uniqueIds = [...new Set((workerIds || []).filter(Boolean).map(String))];
  if (uniqueIds.length === 0) {
    throw new DailyEntryError('Select at least one worker.', 400);
  }

  const results = [];
  for (const workerId of uniqueIds) {
    try {
      const result = await createDailyEntry({
        workerId,
        jobSiteId,
        payPeriodId,
        payCode,
        paychexComponentId,
        dateWorked,
        hours,
        reimbursementAmount,
        enteredBy,
        allowNegative,
      });
      results.push({
        workerId,
        ok: true,
        status: result.correction ? 200 : 201,
        split: Boolean(result.split),
        correction: Boolean(result.correction),
        deleted: Boolean(result.deleted),
        message: result.message || 'Entry saved successfully.',
        entry: result.daily || result.entries?.[0]?.daily || null,
      });
    } catch (error) {
      const wrapped = wrapDailyEntryError(error);
      results.push({
        workerId,
        ok: false,
        status: wrapped.statusCode || 500,
        message: wrapped.message || 'Failed to create entry',
      });
    }
  }

  return {
    results,
    createdCount: results.filter((row) => row.ok).length,
    failedCount: results.filter((row) => !row.ok).length,
  };
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
  createDailyEntryInTransaction,
  createBulkDailyEntries,
  updateDailyEntry,
  deleteDailyEntry,
  recalcAggregatedTimeEntry,
  mapPaychexComponentToPayCode,
};
