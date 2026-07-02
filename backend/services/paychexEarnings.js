/**
 * Build Paychex check pay-component payloads per External API patterns:
 * - Hours-based earnings: payHours only (uses worker default HOURLY_RATE in Paychex)
 * - Reimbursements/misc: payAmount flat dollar amount
 */

function buildHoursEarningPayload({ componentId, jobId, payHours }) {
  return {
    componentId,
    effectOnPay: 'ADDITION',
    jobId,
    payHours,
  };
}

function buildReimbursementEarningPayload({ componentId, jobId, payAmount }) {
  return {
    componentId,
    effectOnPay: 'ADDITION',
    jobId,
    payAmount,
  };
}

module.exports = {
  buildHoursEarningPayload,
  buildReimbursementEarningPayload,
};
