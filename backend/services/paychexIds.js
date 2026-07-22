/**
 * Paychex ID helpers — keep company / worker / pay-period / paycheck IDs distinct.
 *
 * These are not inventable. In particular:
 *   PaychexPayPeriodId MUST come from GET /companies/{companyId}/payperiods
 *   Do not derive, guess, or substitute workerId / paycheckId / local UUIDs.
 *
 * @typedef {string} PaychexCompanyId
 * @typedef {string} PaychexWorkerId
 * @typedef {string} PaychexPayPeriodId  numeric string from Paychex payperiods API
 * @typedef {string} PaychexPaycheckId
 */

/** Known-bad example from Paychex support (wrong account / period). Tests only. */
const SUPPORT_INVALID_PAY_PERIOD_ID = '1140037269275368';

/**
 * @param {unknown} value
 * @returns {value is PaychexPayPeriodId}
 */
function isPaychexPayPeriodId(value) {
  const id = String(value || '').trim();
  // Local approximate keys look like "2026-01-01_2026-01-14"; UUIDs contain hyphens.
  if (!id || id.includes('_') || id.includes('-')) return false;
  return /^\d+$/.test(id);
}

/**
 * @param {unknown} value
 * @returns {PaychexPayPeriodId}
 */
function assertPaychexPayPeriodId(value, context = 'payPeriodId') {
  if (!isPaychexPayPeriodId(value)) {
    const error = new Error(
      `${context} must be a numeric Paychex payPeriodId from GET /companies/{companyId}/payperiods`
    );
    error.statusCode = 400;
    error.code = 'INVALID_PAY_PERIOD_ID';
    throw error;
  }
  return String(value).trim();
}

/**
 * @param {unknown} value
 * @returns {PaychexWorkerId}
 */
function assertPaychexWorkerId(value, context = 'workerId') {
  const id = String(value || '').trim();
  if (!id) {
    const error = new Error(`${context} is required`);
    error.statusCode = 400;
    error.code = 'INVALID_WORKER_ID';
    throw error;
  }
  // Guard against accidentally using a numeric payPeriodId as workerId in paths.
  if (/^\d+$/.test(id) && id.length >= 12) {
    console.warn(
      `[Paychex] Suspicious workerId looks numeric like a payPeriodId: ${id.slice(0, 8)}…`
    );
  }
  return id;
}

/**
 * @param {unknown} value
 * @returns {PaychexCompanyId}
 */
function assertPaychexCompanyId(value, context = 'companyId') {
  const id = String(value || '').trim();
  if (!id) {
    const error = new Error(`${context} is required`);
    error.statusCode = 400;
    error.code = 'INVALID_COMPANY_ID';
    throw error;
  }
  return id;
}

module.exports = {
  SUPPORT_INVALID_PAY_PERIOD_ID,
  isPaychexPayPeriodId,
  assertPaychexPayPeriodId,
  assertPaychexWorkerId,
  assertPaychexCompanyId,
};
