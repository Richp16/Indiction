const { query } = require('../db');

const PAYROLL_PERIODS_LIMIT = 26;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const PAY_PERIOD_SELECT = `
  SELECT
    id,
    paychex_period_id,
    start_date::text AS start_date,
    end_date::text AS end_date,
    submit_by_date::text AS submit_by_date,
    pay_date::text AS pay_date,
    status,
    week1_start::text AS week1_start,
    week1_end::text AS week1_end,
    week2_start::text AS week2_start,
    week2_end::text AS week2_end
  FROM pay_periods`;

function isIsoDate(value) {
  return ISO_DATE_RE.test(String(value || ''));
}

function formatUtcLabel(dateStr) {
  const date = new Date(`${String(dateStr).split('T')[0]}T00:00:00.000Z`);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function formatPeriodLabel(startDate, endDate) {
  const start = String(startDate).split('T')[0];
  const end = String(endDate).split('T')[0];
  const endDateObj = new Date(`${end}T00:00:00.000Z`);
  return `${formatUtcLabel(start)} – ${formatUtcLabel(end)}, ${endDateObj.getUTCFullYear()}`;
}

function addUtcDays(dateStr, days) {
  const date = new Date(`${String(dateStr).split('T')[0]}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function mapPeriodOption(period, { isCurrent = false } = {}) {
  const startDate = period.start_date;
  const endDate = period.end_date;
  const week1Start = period.week1_start || startDate;
  const week1End = period.week1_end || addUtcDays(startDate, 6);
  const week2Start = period.week2_start || addUtcDays(startDate, 7);
  const week2End = period.week2_end || endDate;

  return {
    id: period.id,
    payPeriodId: period.id,
    paychexPeriodId: period.paychex_period_id || null,
    startDate,
    endDate,
    start_date: startDate,
    end_date: endDate,
    week1Start,
    week1End,
    week2Start,
    week2End,
    week1Label: `Week 1: ${formatUtcLabel(week1Start)} – ${formatUtcLabel(week1End)}`,
    week2Label: `Week 2: ${formatUtcLabel(week2Start)} – ${formatUtcLabel(week2End)}`,
    status: period.status,
    label: formatPeriodLabel(startDate, endDate),
    isCurrent: Boolean(isCurrent),
  };
}

/**
 * Same boundary selection used by /api/pay-periods/current:
 * prefer OPEN period covering today, else soonest future OPEN period.
 */
async function findCurrentPayPeriod() {
  let result = await query(
    `${PAY_PERIOD_SELECT}
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
    `${PAY_PERIOD_SELECT}
     WHERE status = 'OPEN'
       AND start_date > CURRENT_DATE
     ORDER BY start_date ASC
     LIMIT 1`
  );

  return result.rows[0] || null;
}

async function findPayPeriodByDateRange(periodStart, periodEnd) {
  if (!isIsoDate(periodStart) || !isIsoDate(periodEnd)) {
    const error = new Error('periodStart and periodEnd must be YYYY-MM-DD');
    error.statusCode = 400;
    throw error;
  }

  const result = await query(
    `${PAY_PERIOD_SELECT}
     WHERE start_date = $1::date
       AND end_date = $2::date
     ORDER BY start_date DESC
     LIMIT 1`,
    [periodStart, periodEnd]
  );

  return result.rows[0] || null;
}

/**
 * Available payroll periods using the company's stored biweekly boundaries
 * (pay_periods), limited to periods that have daily_time_entries / time_entries
 * plus the current open period.
 */
async function listPayrollPayPeriods({ limit = PAYROLL_PERIODS_LIMIT } = {}) {
  const current = await findCurrentPayPeriod();

  const result = await query(
    `${PAY_PERIOD_SELECT}
     WHERE EXISTS (
         SELECT 1 FROM daily_time_entries d WHERE d.pay_period_id = pay_periods.id
       )
       OR EXISTS (
         SELECT 1 FROM time_entries te WHERE te.pay_period_id = pay_periods.id
       )
     ORDER BY start_date DESC
     LIMIT $1`,
    [limit]
  );

  const periods = result.rows;

  return periods.map((period) =>
    mapPeriodOption(period, { isCurrent: Boolean(current && period.id === current.id) })
  );
}

function computeBiweeklyWeekBounds(startDate, endDate) {
  const start = String(startDate).split('T')[0];
  const end = String(endDate).split('T')[0];
  return {
    week1Start: start,
    week1End: addUtcDays(start, 6),
    week2Start: addUtcDays(start, 7),
    week2End: end,
  };
}

function datesOverlap(startA, endA, startB, endB) {
  return startA <= endB && startB <= endA;
}

async function listAllPayPeriods() {
  const current = await findCurrentPayPeriod();
  const result = await query(`${PAY_PERIOD_SELECT} ORDER BY start_date DESC`);
  return result.rows.map((period) =>
    mapPeriodOption(period, { isCurrent: Boolean(current && period.id === current.id) })
  );
}

async function assertNoOverlappingPeriod(startDate, endDate, excludeId = null) {
  const params = [startDate, endDate];
  let sql = `
    SELECT id, start_date::text AS start_date, end_date::text AS end_date
    FROM pay_periods
    WHERE start_date <= $2::date
      AND end_date >= $1::date`;
  if (excludeId) {
    params.push(excludeId);
    sql += ` AND id <> $${params.length}`;
  }
  sql += ' LIMIT 1';
  const overlap = await query(sql, params);
  if (overlap.rows.length > 0) {
    const row = overlap.rows[0];
    const error = new Error(
      `Pay period overlaps existing period ${row.start_date} – ${row.end_date}`
    );
    error.statusCode = 409;
    throw error;
  }
}

async function createManualPayPeriod({
  startDate,
  endDate,
  submitByDate,
  payDate,
  status = 'OPEN',
}) {
  if (!isIsoDate(startDate) || !isIsoDate(endDate)) {
    const error = new Error('startDate and endDate must be YYYY-MM-DD');
    error.statusCode = 400;
    throw error;
  }
  if (!isIsoDate(submitByDate) || !isIsoDate(payDate)) {
    const error = new Error('submitByDate and payDate must be YYYY-MM-DD');
    error.statusCode = 400;
    throw error;
  }
  if (endDate < startDate) {
    const error = new Error('endDate must be on or after startDate');
    error.statusCode = 400;
    throw error;
  }

  await assertNoOverlappingPeriod(startDate, endDate);
  const weeks = computeBiweeklyWeekBounds(startDate, endDate);

  const result = await query(
    `INSERT INTO pay_periods (
       paychex_period_id,
       start_date,
       end_date,
       submit_by_date,
       pay_date,
       status,
       week1_start,
       week1_end,
       week2_start,
       week2_end
     ) VALUES (NULL, $1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING
       id,
       paychex_period_id,
       start_date::text AS start_date,
       end_date::text AS end_date,
       submit_by_date::text AS submit_by_date,
       pay_date::text AS pay_date,
       status,
       week1_start::text AS week1_start,
       week1_end::text AS week1_end,
       week2_start::text AS week2_start,
       week2_end::text AS week2_end`,
    [
      startDate,
      endDate,
      submitByDate,
      payDate,
      status,
      weeks.week1Start,
      weeks.week1End,
      weeks.week2Start,
      weeks.week2End,
    ]
  );

  return mapPeriodOption(result.rows[0]);
}

async function updateManualPayPeriod(id, updates = {}) {
  const existing = await query(`${PAY_PERIOD_SELECT} WHERE id = $1`, [id]);
  if (!existing.rows.length) {
    const error = new Error('Pay period not found');
    error.statusCode = 404;
    throw error;
  }

  const current = existing.rows[0];
  const startDate = updates.startDate || current.start_date;
  const endDate = updates.endDate || current.end_date;
  const submitByDate = updates.submitByDate || current.submit_by_date;
  const payDate = updates.payDate || current.pay_date;
  const status = updates.status || current.status;

  if (!isIsoDate(startDate) || !isIsoDate(endDate)) {
    const error = new Error('startDate and endDate must be YYYY-MM-DD');
    error.statusCode = 400;
    throw error;
  }

  await assertNoOverlappingPeriod(startDate, endDate, id);
  const weeks = computeBiweeklyWeekBounds(startDate, endDate);

  const result = await query(
    `UPDATE pay_periods
     SET start_date = $1,
         end_date = $2,
         submit_by_date = $3,
         pay_date = $4,
         status = $5,
         week1_start = $6,
         week1_end = $7,
         week2_start = $8,
         week2_end = $9
     WHERE id = $10
     RETURNING
       id,
       paychex_period_id,
       start_date::text AS start_date,
       end_date::text AS end_date,
       submit_by_date::text AS submit_by_date,
       pay_date::text AS pay_date,
       status,
       week1_start::text AS week1_start,
       week1_end::text AS week1_end,
       week2_start::text AS week2_start,
       week2_end::text AS week2_end`,
    [
      startDate,
      endDate,
      submitByDate,
      payDate,
      status,
      weeks.week1Start,
      weeks.week1End,
      weeks.week2Start,
      weeks.week2End,
      id,
    ]
  );

  return mapPeriodOption(result.rows[0]);
}

async function deleteManualPayPeriod(id) {
  const existing = await query(`SELECT id FROM pay_periods WHERE id = $1`, [id]);
  if (!existing.rows.length) {
    const error = new Error('Pay period not found');
    error.statusCode = 404;
    throw error;
  }

  const entries = await query(
    `SELECT 1 FROM daily_time_entries WHERE pay_period_id = $1 LIMIT 1`,
    [id]
  );
  if (entries.rows.length > 0) {
    const error = new Error('Cannot delete pay period with time entries');
    error.statusCode = 409;
    throw error;
  }

  await query(`DELETE FROM pay_periods WHERE id = $1`, [id]);
  return { ok: true };
}

async function resolvePayrollPeriodFromQuery({ periodStart, periodEnd, payPeriodId } = {}) {
  if (payPeriodId) {
    const result = await query(`${PAY_PERIOD_SELECT} WHERE id = $1`, [payPeriodId]);
    if (!result.rows.length) {
      const error = new Error('Pay period not found');
      error.statusCode = 404;
      throw error;
    }
    return result.rows[0];
  }

  if (periodStart || periodEnd) {
    if (!periodStart || !periodEnd) {
      const error = new Error('Both periodStart and periodEnd are required');
      error.statusCode = 400;
      throw error;
    }
    const period = await findPayPeriodByDateRange(periodStart, periodEnd);
    if (!period) {
      const error = new Error('Pay period not found for the given date range');
      error.statusCode = 404;
      throw error;
    }
    return period;
  }

  const current = await findCurrentPayPeriod();
  if (!current) {
    const error = new Error('No open pay period found');
    error.statusCode = 404;
    throw error;
  }
  return current;
}

module.exports = {
  PAYROLL_PERIODS_LIMIT,
  isIsoDate,
  formatPeriodLabel,
  mapPeriodOption,
  findCurrentPayPeriod,
  findPayPeriodByDateRange,
  listPayrollPayPeriods,
  listAllPayPeriods,
  computeBiweeklyWeekBounds,
  datesOverlap,
  createManualPayPeriod,
  updateManualPayPeriod,
  deleteManualPayPeriod,
  resolvePayrollPeriodFromQuery,
};
