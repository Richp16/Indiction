const { query } = require('../db');

function parseMoney(value) {
  if (value == null || value === '') return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

/**
 * @returns {Promise<Map<string, { reimbursement_amount: number, short_pay_amount: number }>>}
 */
async function getAdjustmentsForPeriod(payPeriodId) {
  const result = await query(
    `SELECT worker_id::text AS worker_id,
            reimbursement_amount,
            short_pay_amount
     FROM payroll_adjustments
     WHERE pay_period_id = $1`,
    [payPeriodId]
  );

  const map = new Map();
  for (const row of result.rows) {
    map.set(row.worker_id, {
      reimbursement_amount: parseMoney(row.reimbursement_amount),
      short_pay_amount: parseMoney(row.short_pay_amount),
    });
  }
  return map;
}

/**
 * Base reimbursement sums from time_entries (before payroll_adjustments).
 * @returns {Promise<Map<string, number>>} worker UUID → base reimbursement
 */
async function getBaseReimbursementsForPeriod(payPeriodId) {
  const result = await query(
    `SELECT worker_id::text AS worker_id,
            COALESCE(SUM(reimbursement_amount), 0) AS base_reimbursement
     FROM time_entries
     WHERE pay_period_id = $1
     GROUP BY worker_id`,
    [payPeriodId]
  );

  const map = new Map();
  for (const row of result.rows) {
    map.set(row.worker_id, parseMoney(row.base_reimbursement));
  }
  return map;
}

/**
 * Upsert money adjustments for SPI export.
 *
 * Accepts either:
 * - `{ workerId, reimbursementAmount, shortPayAmount, asAbsolute: true }` — cell values
 *   from the Payroll UI; reimbursement is converted to a delta over time_entries base.
 * - `{ workerId, reimbursementAmount, shortPayAmount }` without asAbsolute — stored as-is
 *   (additive deltas), used by tests / internal callers.
 *
 * @param {string} payPeriodId
 * @param {Array<object>} adjustments
 */
async function upsertAdjustments(payPeriodId, adjustments, { asAbsolute = false } = {}) {
  if (!Array.isArray(adjustments) || adjustments.length === 0) {
    return { upserted: 0 };
  }

  const baseByWorker = asAbsolute
    ? await getBaseReimbursementsForPeriod(payPeriodId)
    : null;

  let upserted = 0;
  for (const item of adjustments) {
    const workerId = item.workerId;
    if (!workerId) continue;

    let reimbursementAmount = parseMoney(item.reimbursementAmount);
    const shortPayAmount = parseMoney(item.shortPayAmount);

    if (asAbsolute) {
      const base = baseByWorker.get(String(workerId)) || 0;
      reimbursementAmount = parseMoney(reimbursementAmount - base);
    }

    await query(
      `INSERT INTO payroll_adjustments (
         pay_period_id, worker_id, reimbursement_amount, short_pay_amount
       ) VALUES ($1, $2, $3, $4)
       ON CONFLICT (pay_period_id, worker_id)
       DO UPDATE SET
         reimbursement_amount = EXCLUDED.reimbursement_amount,
         short_pay_amount     = EXCLUDED.short_pay_amount,
         updated_at           = now()`,
      [payPeriodId, workerId, reimbursementAmount, shortPayAmount]
    );
    upserted += 1;
  }

  return { upserted };
}

module.exports = {
  getAdjustmentsForPeriod,
  getBaseReimbursementsForPeriod,
  upsertAdjustments,
  parseMoney,
};
