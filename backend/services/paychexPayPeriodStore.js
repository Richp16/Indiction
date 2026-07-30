/**
 * Local persistence for Paychex-discovered pay periods (paychex_pay_periods).
 *
 * This is separate from operational `pay_periods` used by Daily Entry / Payroll.
 * A local pay_periods row may reference paychex_period_id, but that does not
 * automatically authorize /checks — prefer validating against this table.
 */

const { query } = require('../db');
const {
  getCompanyPayPeriods,
  buildPaychexDateRange,
  normalizePaychexDateBounds,
} = require('./paychexPayPeriodApi');
const {
  assertPaychexCompanyId,
  assertPaychexPayPeriodId,
  isPaychexPayPeriodId,
} = require('./paychexIds');

function defaultSyncRangeUtc() {
  return buildPaychexDateRange();
}

/**
 * @param {string | null | undefined} value
 * @returns {Date | null}
 */
function safeParseDate(value) {
  if (value == null || value === '') return null;
  const raw = String(value).trim();
  if (!raw || /^invalid/i.test(raw)) return null;

  // Prefer ISO date-only (YYYY-MM-DD) as UTC midnight.
  const dayOnly = raw.split('T')[0];
  if (/^\d{4}-\d{2}-\d{2}$/.test(dayOnly)) {
    const utc = new Date(`${dayOnly}T00:00:00.000Z`);
    return Number.isNaN(utc.getTime()) ? null : utc;
  }

  const parsed = new Date(raw);
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
}

const STANDARD_PERIOD_LENGTH_DAYS = 13; // inclusive: 14 calendar days

function isStandardBiweeklyPeriod(startDate, endDate) {
  const start = safeParseDate(startDate);
  const end = safeParseDate(endDate);
  if (!start || !end) return false;
  const diffDays = Math.round((end.getTime() - start.getTime()) / 86400000);
  return diffDays === STANDARD_PERIOD_LENGTH_DAYS;
}

function formatUtcMonthDay(date) {
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function isNonPayrollDescription(description) {
  const text = String(description || '')
    .trim()
    .toLowerCase();
  if (!text) return false;
  return (
    text === 'void' ||
    text.includes('void') ||
    text === 'manual adjustment' ||
    text.includes('manual adjustment')
  );
}

function checkCountSuffix(checkCount) {
  if (checkCount == null || !Number.isFinite(Number(checkCount))) return '';
  return ` (${Number(checkCount)} checks)`;
}

/**
 * Build a human-readable dropdown label without throwing on bad dates.
 * Date-range formatting runs only when both start and end parse successfully
 * and the period is not a void / non-payroll description.
 */
function buildPaychexPeriodLabel({ startDate, endDate, description, checkCount, payPeriodId }) {
  const desc = description && String(description).trim() ? String(description).trim() : '';
  const start = safeParseDate(startDate);
  const end = safeParseDate(endDate);

  if (!isNonPayrollDescription(desc) && start && end) {
    const year = end.getUTCFullYear();
    return `${formatUtcMonthDay(start)} – ${formatUtcMonthDay(end)}, ${year}`;
  }

  if (desc) {
    return `${desc}${checkCountSuffix(checkCount)}`;
  }

  if (checkCount != null && Number.isFinite(Number(checkCount))) {
    return `Pay period (${Number(checkCount)} checks)`;
  }

  return payPeriodId ? `Pay period ${payPeriodId}` : 'Pay period';
}

function addUtcDays(dateStr, days) {
  const date = safeParseDate(dateStr);
  if (!date) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatUtcLabel(dateStr) {
  const date = safeParseDate(dateStr);
  if (!date) return '';
  return formatUtcMonthDay(date);
}

function toDateOnlyString(value) {
  const date = safeParseDate(value);
  return date ? date.toISOString().slice(0, 10) : null;
}

function mapStoredRow(row) {
  if (!row) return null;

  const startDate = toDateOnlyString(row.start_date);
  const endDate = toDateOnlyString(row.end_date);
  const week1Start = startDate;
  const week1End = startDate ? addUtcDays(startDate, 6) : null;
  const week2Start = startDate ? addUtcDays(startDate, 7) : null;
  const week2End = endDate;

  const label = buildPaychexPeriodLabel({
    startDate,
    endDate,
    description: row.description,
    checkCount: row.check_count,
    payPeriodId: row.pay_period_id,
  });

  return {
    id: row.id,
    companyId: row.company_id,
    payPeriodId: row.pay_period_id,
    paychexPayPeriodId: row.pay_period_id,
    intervalCode: row.interval_code,
    status: row.status,
    description: row.description,
    startDate,
    endDate,
    submitByDate: toDateOnlyString(row.submit_by_date),
    checkDate: toDateOnlyString(row.check_date),
    checkCount: row.check_count,
    week1Start,
    week1End,
    week2Start,
    week2End,
    week1Label:
      week1Start && week1End
        ? `Week 1: ${formatUtcLabel(week1Start)} – ${formatUtcLabel(week1End)}`
        : 'Week 1: (no dates)',
    week2Label:
      week2Start && week2End
        ? `Week 2: ${formatUtcLabel(week2Start)} – ${formatUtcLabel(week2End)}`
        : 'Week 2: (no dates)',
    label,
    displayLabel: label,
    hasValidDates: Boolean(startDate && endDate),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * @param {string} companyId
 * @param {object} period normalized from getCompanyPayPeriods
 * @returns {Promise<'inserted'|'updated'>}
 */
async function upsertPaychexPayPeriod(companyId, period) {
  const result = await query(
    `INSERT INTO paychex_pay_periods (
       company_id, pay_period_id, interval_code, status, description,
       start_date, end_date, submit_by_date, check_date, check_count, raw_json,
       created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5,
       $6::date, $7::date, $8::date, $9::date, $10, $11::jsonb,
       now(), now()
     )
     ON CONFLICT (company_id, pay_period_id) DO UPDATE SET
       interval_code = EXCLUDED.interval_code,
       status = EXCLUDED.status,
       description = EXCLUDED.description,
       start_date = EXCLUDED.start_date,
       end_date = EXCLUDED.end_date,
       submit_by_date = EXCLUDED.submit_by_date,
       check_date = EXCLUDED.check_date,
       check_count = EXCLUDED.check_count,
       raw_json = EXCLUDED.raw_json,
       updated_at = now()
     RETURNING (xmax = 0) AS inserted`,
    [
      companyId,
      period.payPeriodId,
      period.intervalCode,
      period.status,
      period.description,
      toDateOnlyString(period.startDate),
      toDateOnlyString(period.endDate),
      toDateOnlyString(period.submitByDate),
      toDateOnlyString(period.checkDate),
      period.checkCount,
      JSON.stringify(period.raw || period),
    ]
  );

  return result.rows[0]?.inserted ? 'inserted' : 'updated';
}

/**
 * Sync COMPLETED Paychex pay periods into `paychex_pay_periods` (checks catalog).
 *
 * PURPOSE: Discover historical payPeriodIds safe for GET .../checks.
 * Default status filter is COMPLETED; default date window is buildPaychexDateRange()
 * (UTC start-of-day one year ago → end-of-today, no milliseconds).
 *
 * Not used for Daily Entry / Payroll — those use syncPayPeriods() → `pay_periods`
 * with status=OPEN.
 */
async function syncCompanyPayPeriods({
  companyId,
  from,
  to,
  statuses = ['COMPLETED'],
} = {}) {
  const cid = assertPaychexCompanyId(companyId);
  const bounds =
    from && to ? normalizePaychexDateBounds(from, to) : defaultSyncRangeUtc();
  const statusList = Array.isArray(statuses) && statuses.length > 0 ? statuses : ['COMPLETED'];

  console.log(
    `[Paychex] Syncing pay periods company=${cid} from=${bounds.from} to=${bounds.to} statuses=${statusList.join(',')}`
  );

  const periods = await getCompanyPayPeriods({
    companyId: cid,
    from: bounds.from,
    to: bounds.to,
    status: statusList,
  });

  const standardPeriods = periods.filter((period) =>
    isStandardBiweeklyPeriod(period.startDate, period.endDate)
  );

  const droppedPeriods = periods.filter(
    (period) => !isStandardBiweeklyPeriod(period.startDate, period.endDate)
  );

  console.log('[Paychex] Filtered to standard biweekly periods', {
    companyId: cid,
    totalFetched: periods.length,
    standardCount: standardPeriods.length,
    droppedCount: droppedPeriods.length,
  });
  if (droppedPeriods.length > 0) {
    console.log(
      '[Paychex] Dropped non-biweekly catalog periods:',
      droppedPeriods.map((period) => ({
        payPeriodId: period.payPeriodId || period.pay_period_id,
        startDate: period.startDate || period.start_date,
        endDate: period.endDate || period.end_date,
        status: period.status,
      }))
    );
  }

  let insertedCount = 0;
  let updatedCount = 0;

  for (const period of standardPeriods) {
    const result = await upsertPaychexPayPeriod(cid, period);
    if (result === 'inserted') insertedCount += 1;
    else updatedCount += 1;
  }

  console.log(`[Paychex] Synced ${standardPeriods.length} standard biweekly pay periods for company=${cid}`);

  return {
    fetchedCount: standardPeriods.length,
    insertedCount,
    updatedCount,
    companyId: cid,
    from: bounds.from,
    to: bounds.to,
    statuses: statusList,
  };
}

/**
 * @returns {Promise<object|null>}
 */
async function findLocalPayPeriod(companyId, payPeriodId) {
  const cid = assertPaychexCompanyId(companyId);
  if (!isPaychexPayPeriodId(payPeriodId)) return null;

  const result = await query(
    `SELECT *
     FROM paychex_pay_periods
     WHERE company_id = $1 AND pay_period_id = $2`,
    [cid, String(payPeriodId).trim()]
  );

  return mapStoredRow(result.rows[0] || null);
}

/**
 * Throws 404 if payPeriodId was not previously synced for this company.
 */
async function requireLocalPayPeriod(companyId, payPeriodId) {
  const pid = assertPaychexPayPeriodId(payPeriodId);
  const row = await findLocalPayPeriod(companyId, pid);
  if (!row) {
    const error = new Error(
      'Unknown payPeriodId for company. Sync pay periods first.'
    );
    error.statusCode = 404;
    error.code = 'UNKNOWN_PAY_PERIOD';
    throw error;
  }
  return row;
}

/**
 * List locally persisted Paychex pay periods from `paychex_pay_periods` only
 * (newest end_date first). Does not read operational `pay_periods`.
 */
async function listLocalPayPeriods(companyId, { status, from, to, hasHours } = {}) {
  const cid = assertPaychexCompanyId(companyId);
  const params = [cid];
  const clauses = ['company_id = $1'];

  if (status) {
    params.push(status);
    clauses.push(`status = $${params.length}`);
  }
  if (from) {
    params.push(String(from).split('T')[0]);
    clauses.push(`end_date >= $${params.length}::date`);
  }
  if (to) {
    params.push(String(to).split('T')[0]);
    clauses.push(`start_date <= $${params.length}::date`);
  }
  if (hasHours) {
    clauses.push(
      `EXISTS (
        SELECT 1 FROM pay_periods pp
        JOIN daily_time_entries dte ON dte.pay_period_id = pp.id
        WHERE pp.start_date = paychex_pay_periods.start_date
          AND pp.end_date = paychex_pay_periods.end_date
      )`
    );
  }

  const result = await query(
    `SELECT *
     FROM paychex_pay_periods
     WHERE ${clauses.join(' AND ')}
     ORDER BY end_date DESC NULLS LAST, pay_period_id DESC`,
    params
  );

  return result.rows.map(mapStoredRow);
}

module.exports = {
  defaultSyncRangeUtc,
  safeParseDate,
  buildPaychexPeriodLabel,
  upsertPaychexPayPeriod,
  syncCompanyPayPeriods,
  findLocalPayPeriod,
  requireLocalPayPeriod,
  listLocalPayPeriods,
  mapStoredRow,
  isStandardBiweeklyPeriod,
};
