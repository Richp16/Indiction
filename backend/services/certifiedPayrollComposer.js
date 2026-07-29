/**
 * Certified Payroll composer:
 * - Hours / day breakdown → internal daily_time_entries (via loadHoursRows)
 * - Gross / deductions / taxes / net → Paychex company checks for paychexPayPeriodId
 */

const { companyId: envCompanyId } = require('../config/paychexApi');
const { isPaychexPayPeriodId } = require('./paychexIds');
const { normalizeCheck } = require('./paychexPayPeriodApi');
const {
  getCompanyChecksForHistory,
  parseCheckForSupplement,
  extractWorkerIdFromCheck,
  getCheckGrossAmount,
  indexChecksByWorker,
} = require('./paychexCompanyChecks');
const { getPayComponentNameMap } = require('./paychexPayComponents');
const { estimateDeductions } = require('./payrollTaxEstimate');

/**
 * Index checks by Paychex workerId; track workers with multiple checks.
 */
function indexChecksByWorkerDetailed(checks) {
  const lists = {};
  for (const check of checks || []) {
    const workerId = extractWorkerIdFromCheck(check);
    if (!workerId) continue;
    const key = String(workerId);
    if (!lists[key]) lists[key] = [];
    lists[key].push(check);
  }

  const checksByWorker = {};
  const workersWithMultipleChecksInSamePayPeriod = [];

  for (const [workerId, list] of Object.entries(lists)) {
    if (list.length > 1) {
      workersWithMultipleChecksInSamePayPeriod.push(workerId);
    }
    checksByWorker[workerId] = list.reduce((best, check) =>
      getCheckGrossAmount(check) > getCheckGrossAmount(best) ? check : best
    );
  }

  return {
    checksByWorker,
    workersWithMultipleChecksInSamePayPeriod,
    checkCountByWorker: Object.fromEntries(
      Object.entries(lists).map(([id, list]) => [id, list.length])
    ),
  };
}

function mergeOtherDeductions(otherDeductions) {
  if (!otherDeductions?.length) {
    return { amount: 0, label: '' };
  }
  const amount = otherDeductions.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const label = otherDeductions.map((item) => item.label).filter(Boolean).join(', ');
  return {
    amount,
    label,
  };
}

/**
 * Explicit Paychex → WH-347 supplement money mapping (no inferred tax math).
 */
function mapPaychexCheckToSupplementFields(rawCheck, componentMap = new Map()) {
  if (!rawCheck) return null;

  const normalized = normalizeCheck(rawCheck);
  const parsed = parseCheckForSupplement(rawCheck, componentMap);
  if (!parsed) return null;

  const other = mergeOtherDeductions(parsed.otherDeductions);
  const withholding = Number(parsed.federalWithholding) || 0;
  const fica = Number(parsed.fica) || 0;
  const totalDeductions = withholding + fica + other.amount;

  return {
    payPeriodId: normalized?.payPeriodId || null,
    paycheckId: normalized?.paycheckId || null,
    workerId: normalized?.workerId || extractWorkerIdFromCheck(rawCheck) || null,
    checkDate: normalized?.checkDate || null,
    checkType: normalized?.checkType || null,
    checkNumber: normalized?.checkNumber || null,
    grossAllWork: parsed.grossPay,
    withholding,
    fica,
    otherAmount: other.amount,
    otherLabel: other.label,
    totalDeductions,
    netPay: parsed.netPay,
    reimbursementAmount: parsed.reimbursementAmount || 0,
    checkNetPay: parsed.checkNetPay,
    computedNetPay: parsed.computedNetPay,
    netPayDrift: parsed.netPayDrift || 0,
    hasSignificantNetPayDrift: Boolean(parsed.hasSignificantNetPayDrift),
    earnings: normalized?.earnings || [],
    deductions: normalized?.deductions || [],
    taxes: normalized?.taxes || [],
    normalized,
    parsed,
  };
}

function buildReconciliationWarnings({
  workers,
  checksByWorker,
  workersWithMultipleChecksInSamePayPeriod = [],
  checksFetchMeta = null,
  componentMap = new Map(),
}) {
  const hourWorkerPaychexIds = new Set(
    workers.map((w) => w.paychexWorkerId).filter(Boolean).map(String)
  );
  const checkWorkerIds = new Set(Object.keys(checksByWorker || {}));

  const workersWithHoursButNoPaychexCheck = workers
    .filter((w) => w.paychexWorkerId && !checksByWorker[String(w.paychexWorkerId)])
    .map((w) => ({
      workerId: w.workerId,
      paychexWorkerId: w.paychexWorkerId,
      workerName: w.workerName,
      ...(checksFetchMeta?.checksUnavailable
        ? {
            reason: checksFetchMeta.checksUnavailableCode || 'CHECKS_UNAVAILABLE',
            message: checksFetchMeta.checksUnavailableMessage || null,
          }
        : {}),
    }));

  const workersWithHoursButNoPaychexWorkerId = workers
    .filter((w) => !w.paychexWorkerId)
    .map((w) => ({
      workerId: w.workerId,
      workerName: w.workerName,
    }));

  const paychexChecksWithoutCertifiedPayrollRows = [...checkWorkerIds]
    .filter((paychexWorkerId) => !hourWorkerPaychexIds.has(paychexWorkerId))
    .map((paychexWorkerId) => ({
      paychexWorkerId,
      paycheckId:
        mapPaychexCheckToSupplementFields(checksByWorker[paychexWorkerId], componentMap)
          ?.paycheckId || null,
    }));

  const checksUnavailable = checksFetchMeta?.checksUnavailable
    ? {
        code: checksFetchMeta.checksUnavailableCode || 'CHECKS_UNAVAILABLE',
        message:
          checksFetchMeta.checksUnavailableMessage ||
          'Paychex checks are not available for this pay period.',
        periodStatus: checksFetchMeta.periodStatus || null,
        payPeriodId: checksFetchMeta.payPeriodId || null,
      }
    : null;

  return {
    workersWithHoursButNoPaychexCheck,
    workersWithHoursButNoPaychexWorkerId,
    paychexChecksWithoutCertifiedPayrollRows,
    workersWithMultipleChecksInSamePayPeriod: workersWithMultipleChecksInSamePayPeriod.map(
      (paychexWorkerId) => ({ paychexWorkerId })
    ),
    checksUnavailable,
  };
}

/**
 * Compare company-check mapping vs worker-check mapping for one worker (tests / debug).
 */
function companyAndWorkerChecksAgree(companyRawCheck, workerRawCheck, componentMap = new Map()) {
  const fromCompany = mapPaychexCheckToSupplementFields(companyRawCheck, componentMap);
  const fromWorker = mapPaychexCheckToSupplementFields(workerRawCheck, componentMap);
  if (!fromCompany || !fromWorker) {
    return { agree: false, fromCompany, fromWorker, reason: 'missing_check' };
  }

  const fields = ['grossAllWork', 'withholding', 'fica', 'netPay', 'otherAmount'];
  const mismatches = fields.filter(
    (field) => Number(fromCompany[field]) !== Number(fromWorker[field])
  );

  return {
    agree: mismatches.length === 0,
    mismatches,
    fromCompany,
    fromWorker,
  };
}

module.exports = {
  indexChecksByWorkerDetailed,
  mapPaychexCheckToSupplementFields,
  buildReconciliationWarnings,
  companyAndWorkerChecksAgree,
  mergeOtherDeductions,
  // Re-export for convenience in tests
  indexChecksByWorker,
  getCompanyChecksForHistory,
  getPayComponentNameMap,
  estimateDeductions,
  envCompanyId,
  isPaychexPayPeriodId,
};
