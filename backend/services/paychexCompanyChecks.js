const { companyId } = require('../config/paychexApi');
const { formatPaychexErrorForLog } = require('./paychexErrors');
const { roundMoney } = require('./payrollTaxEstimate');
const { resolveComponentLabel } = require('./paychexPayComponents');
const { isPaychexPayPeriodId } = require('./paychexIds');
const {
  getCompanyChecksByPayPeriod,
  getWorkerChecksByPayPeriod,
} = require('./paychexPayPeriodApi');
const { findLocalPayPeriod } = require('./paychexPayPeriodStore');

const HISTORY_MONTHS = 6;
const CLOSED_PERIODS_LIMIT = 10;

let cachedChecks = null;
let cachedChecksKey = null;
let loggedSampleCheck = false;
let loggedParsedCheck = false;
let loggedMissingPayPeriodId = false;
let loggedUnknownPayPeriodId = false;

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function fmtUtcDate(date) {
  return date.toISOString().split('T')[0];
}

function todayUtcMidnight() {
  const today = new Date();
  return new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
}

function parsePaychexDateString(value) {
  if (!value) return null;
  const dateStr = String(value).split('T')[0];
  const date = new Date(`${dateStr}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function buildHistoryDateWindow() {
  const today = new Date();
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - HISTORY_MONTHS);

  return {
    startDate: fmtUtcDate(sixMonthsAgo),
    endDate: fmtUtcDate(today),
  };
}

function logCompanyChecksError(error) {
  const status = error.statusCode ?? error.response?.status;
  const body = error.response?.data || error.message;

  if (status === 403 || status === 401) {
    console.error(
      '[PaychexChecks] Auth failure fetching checks. Contact ' +
        'Paychex Developer Support if historical payroll scope is missing.',
      { status, error: formatPaychexErrorForLog(error) }
    );
    return;
  }

  if (status === 404) {
    console.error('[PaychexChecks] Pay period or checks not found:', {
      status,
      error: formatPaychexErrorForLog(error),
    });
    return;
  }

  if (status >= 500) {
    console.error('[PaychexChecks] Paychex server error (API-1 or similar):', {
      status,
      error: formatPaychexErrorForLog(error),
      body,
    });
    return;
  }

  console.error('[PaychexChecks] Request failed:', formatPaychexErrorForLog(error));
}

/**
 * Company checks — only with a numeric payPeriodId from Paychex /payperiods.
 * Prefer validating against paychex_pay_periods (see getCompanyChecksForHistory).
 *
 * @deprecated Prefer getCompanyChecksByPayPeriod from paychexPayPeriodApi after
 *   requireLocalPayPeriod. Kept for certified-payroll internal callers.
 */
async function fetchCompanyChecksByPayPeriodId(payPeriodId) {
  if (!isPaychexPayPeriodId(payPeriodId)) {
    return [];
  }

  const cid = companyId();
  if (!cid) return [];

  try {
    const checks = await getCompanyChecksByPayPeriod({
      companyId: cid,
      payPeriodId,
    });

    if (checks.length > 0 && !loggedSampleCheck) {
      loggedSampleCheck = true;
      console.log(
        '[PaychexChecks] Sample check structure:',
        JSON.stringify(checks[0]?.raw || checks[0], null, 2)
      );
    }

    // Return raw Paychex payloads for existing parsers (parseCheckForSupplement).
    return checks.map((check) => check.raw || check);
  } catch (error) {
    logCompanyChecksError(error);
    const err = error;
    err._checksFetchFailed = true;
    throw err;
  }
}

/**
 * Worker checks — workerId in path, payPeriodId in query only.
 *
 * @deprecated Prefer getWorkerChecksByPayPeriod after requireLocalPayPeriod.
 */
async function fetchWorkerChecksByPayPeriodId(workerId, payPeriodId) {
  if (!workerId || !isPaychexPayPeriodId(payPeriodId)) {
    return [];
  }

  try {
    const checks = await getWorkerChecksByPayPeriod({
      workerId,
      payPeriodId,
      companyId: companyId() || undefined,
    });
    return checks.map((check) => check.raw || check);
  } catch (error) {
    logCompanyChecksError(error);
    return [];
  }
}

/**
 * Fetch checks for a Paychex payPeriodId that exists in paychex_pay_periods.
 * Does not invent IDs; skips unknown local IDs until sync runs.
 *
 * @returns {Promise<{ checks: object[], meta: object }>}
 */
async function getCompanyChecksForHistory({ forceRefresh = false, payPeriodId = null } = {}) {
  const emptyMeta = {
    payPeriodId: payPeriodId ? String(payPeriodId) : null,
    periodStatus: null,
    checksUnavailable: false,
    checksUnavailableCode: null,
    checksUnavailableMessage: null,
  };

  if (!isPaychexPayPeriodId(payPeriodId)) {
    if (!loggedMissingPayPeriodId) {
      loggedMissingPayPeriodId = true;
      console.warn(
        '[PaychexChecks] Skipping /checks fetch: no Paychex payPeriodId available. ' +
          'Sync pay periods via POST /api/paychex/companies/:companyId/pay-periods/sync first.'
      );
    }
    return { checks: [], meta: emptyMeta };
  }

  const cid = companyId();
  let periodStatus = null;
  if (cid) {
    const known = await findLocalPayPeriod(cid, payPeriodId);
    if (!known) {
      if (!loggedUnknownPayPeriodId) {
        loggedUnknownPayPeriodId = true;
        console.warn(
          '[PaychexChecks] Unknown payPeriodId for company — not in paychex_pay_periods. ' +
            'Sync pay periods first.',
          { companyId: cid, payPeriodId: String(payPeriodId) }
        );
      }
      return {
        checks: [],
        meta: {
          ...emptyMeta,
          checksUnavailable: true,
          checksUnavailableCode: 'UNKNOWN_PAY_PERIOD',
          checksUnavailableMessage:
            'Unknown payPeriodId for company. Sync pay periods first.',
        },
      };
    }
    periodStatus = known.status || null;
  }

  const key = String(payPeriodId);
  if (!forceRefresh && cachedChecksKey === key && cachedChecks) {
    return {
      checks: cachedChecks,
      meta: {
        ...emptyMeta,
        periodStatus,
      },
    };
  }

  try {
    cachedChecks = await fetchCompanyChecksByPayPeriodId(payPeriodId);
    cachedChecksKey = key;
    return {
      checks: cachedChecks,
      meta: {
        ...emptyMeta,
        periodStatus,
      },
    };
  } catch (error) {
    // fetchCompanyChecksByPayPeriodId normally swallows errors; keep defensive.
    logCompanyChecksError(error);
    const code = error.code || error.paychexErrorCode || 'API-1';
    return {
      checks: [],
      meta: {
        ...emptyMeta,
        periodStatus: error.paychexContext?.periodStatus || periodStatus,
        checksUnavailable: true,
        checksUnavailableCode: code,
        checksUnavailableMessage: error.message,
      },
    };
  }
}

function extractPayPeriodFromCheck(check) {
  const start =
    check.payPeriod?.startDate ??
    check.periodStartDate ??
    check.payroll?.startDate ??
    check.payPeriodStartDate;
  const end =
    check.payPeriod?.endDate ??
    check.periodEndDate ??
    check.payroll?.endDate ??
    check.payPeriodEndDate;

  if (!start || !end) return null;

  return {
    startDate: String(start).split('T')[0],
    endDate: String(end).split('T')[0],
  };
}

function extractWorkerIdFromCheck(check) {
  return (
    check.workerId ||
    check.paychexWorkerId ||
    check.employeeId ||
    check.worker?.workerId
  );
}

function getCheckGrossAmount(check) {
  if (check.grossEarnings != null) return toNumber(check.grossEarnings);
  if (check.grossPay != null) return toNumber(check.grossPay);
  const earnings = check.earnings || check.payComponents || [];
  return earnings.reduce((sum, item) => sum + toNumber(item.amount ?? item.value ?? item.payAmount), 0);
}

function indexChecksByWorker(checks) {
  const map = {};

  for (const check of checks) {
    const workerId = extractWorkerIdFromCheck(check);
    if (!workerId) continue;

    const key = String(workerId);
    if (!map[key]) {
      map[key] = check;
      continue;
    }

    if (getCheckGrossAmount(check) > getCheckGrossAmount(map[key])) {
      map[key] = check;
    }
  }

  return map;
}

function filterChecksForPayPeriod(checks, startDate, endDate) {
  const normalizedStart = String(startDate).split('T')[0];
  const normalizedEnd = String(endDate).split('T')[0];

  return checks.filter((check) => {
    const period = extractPayPeriodFromCheck(check);
    if (!period) return false;
    return period.startDate === normalizedStart && period.endDate === normalizedEnd;
  });
}

function isEmployeeTaxEntry(tax) {
  const componentType = String(tax.componentType ?? tax.type ?? '').toUpperCase();
  return !['EMPLOYER', 'INFORMATIONAL'].includes(componentType);
}

function parseCheckForSupplement(check, componentMap = new Map()) {
  if (!check) return null;

  const grossPay = roundMoney(getCheckGrossAmount(check));
  const netPay = roundMoney(check.netPay ?? check.netEarnings ?? check.netPayAmount ?? 0);

  const taxes = (check.taxes ?? check.taxWithholdings ?? check.taxDeductions ?? []).filter(
    isEmployeeTaxEntry
  );

  const federalWithholding = roundMoney(
    taxes
      .filter((tax) => /FEDERAL|FIT|FEDERAL_INCOME/i.test(tax.taxType ?? tax.type ?? tax.name ?? ''))
      .reduce((sum, tax) => sum + toNumber(tax.amount ?? tax.value ?? tax.payAmount), 0)
  );

  const fica = roundMoney(
    taxes
      .filter((tax) => /SOCIAL|MEDICARE/i.test(tax.taxType ?? tax.type ?? tax.name ?? ''))
      .reduce((sum, tax) => sum + toNumber(tax.amount ?? tax.value ?? tax.payAmount), 0)
  );

  const otherDeductions = (check.deductions ?? check.benefitDeductions ?? [])
    .map((deduction) => {
      const amount = toNumber(deduction.amount ?? deduction.value ?? deduction.payAmount);
      if (amount <= 0) return null;
      return {
        label: resolveComponentLabel(deduction, componentMap),
        amount: roundMoney(amount),
      };
    })
    .filter(Boolean);

  for (const tax of taxes) {
    const taxType = String(tax.taxType ?? tax.type ?? tax.name ?? '');
    if (/STATE/i.test(taxType)) {
      const amount = toNumber(tax.amount ?? tax.value ?? tax.payAmount);
      if (amount > 0) {
        otherDeductions.push({ label: 'State Tax', amount: roundMoney(amount) });
      }
    }
  }

  if (!loggedParsedCheck && grossPay > 0) {
    loggedParsedCheck = true;
    console.log('[PaychexChecks] Parsed supplement sample:', {
      grossPay: grossPay.toFixed(2),
      netPay: netPay.toFixed(2),
      federalWithholding: federalWithholding.toFixed(2),
      fica: fica.toFixed(2),
      otherDeductions,
    });
  }

  if (grossPay <= 0 && netPay <= 0) {
    return null;
  }

  return {
    grossPay,
    netPay: netPay || roundMoney(grossPay - federalWithholding - fica -
      otherDeductions.reduce((sum, item) => sum + item.amount, 0)),
    federalWithholding,
    fica,
    otherDeductions,
    isEstimate: false,
  };
}

function formatUtcLabel(dateStr) {
  const date = new Date(`${dateStr}T00:00:00.000Z`);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function formatUtcRangeLabel(startDate, endDate) {
  const end = new Date(`${endDate}T00:00:00.000Z`);
  return `${formatUtcLabel(startDate)} – ${formatUtcLabel(endDate)}, ${end.getUTCFullYear()}`;
}

function buildPeriodShape(period, { approximate = false } = {}) {
  const start = parsePaychexDateString(period.startDate);
  const end = parsePaychexDateString(period.endDate);
  if (!start || !end) return null;

  const w1End = new Date(start);
  w1End.setUTCDate(w1End.getUTCDate() + 6);
  const w2Start = new Date(w1End);
  w2Start.setUTCDate(w2Start.getUTCDate() + 1);

  const startIso = fmtUtcDate(start);
  const endIso = fmtUtcDate(end);
  const w1EndIso = fmtUtcDate(w1End);
  const w2StartIso = fmtUtcDate(w2Start);
  const baseLabel = formatUtcRangeLabel(startIso, endIso);
  const label = approximate ? `${baseLabel} (From our records)` : baseLabel;

  return {
    payPeriodId: `${startIso}_${endIso}`,
    startDate: startIso,
    endDate: endIso,
    week1Start: startIso,
    week1End: w1EndIso,
    week2Start: w2StartIso,
    week2End: endIso,
    label,
    week1Label: `Week 1: ${formatUtcLabel(startIso)} – ${formatUtcLabel(w1EndIso)}`,
    week2Label: `Week 2: ${formatUtcLabel(w2StartIso)} – ${formatUtcLabel(endIso)}`,
    approximate,
  };
}

function reconstructPayPeriodsFromChecks(checks) {
  const periodMap = new Map();

  for (const check of checks) {
    const period = extractPayPeriodFromCheck(check);
    if (!period) continue;

    const key = `${period.startDate}_${period.endDate}`;
    if (!periodMap.has(key)) {
      periodMap.set(key, period);
    }
  }

  const todayUTC = todayUtcMidnight();
  const closed = [...periodMap.values()].filter((period) => {
    const end = parsePaychexDateString(period.endDate);
    return end && end < todayUTC;
  });

  console.log('[PaychexChecks] Reconstructed pay periods from checks:', {
    distinct: periodMap.size,
    closed: closed.length,
  });

  return closed
    .sort((a, b) => parsePaychexDateString(b.endDate) - parsePaychexDateString(a.endDate))
    .slice(0, CLOSED_PERIODS_LIMIT)
    .map((period) => buildPeriodShape(period))
    .filter(Boolean);
}

function parsePayPeriodId(payPeriodId) {
  const match = /^(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})$/.exec(String(payPeriodId || ''));
  if (!match) return null;

  return buildPeriodShape({
    startDate: match[1],
    endDate: match[2],
  });
}

function clearCompanyChecksCache() {
  cachedChecks = null;
  cachedChecksKey = null;
}

module.exports = {
  HISTORY_MONTHS,
  CLOSED_PERIODS_LIMIT,
  buildHistoryDateWindow,
  isPaychexPayPeriodId,
  fetchCompanyChecksByPayPeriodId,
  fetchWorkerChecksByPayPeriodId,
  getCompanyChecksForHistory,
  extractPayPeriodFromCheck,
  extractWorkerIdFromCheck,
  getCheckGrossAmount,
  indexChecksByWorker,
  filterChecksForPayPeriod,
  parseCheckForSupplement,
  reconstructPayPeriodsFromChecks,
  buildPeriodShape,
  parsePayPeriodId,
  parsePaychexDateString,
  todayUtcMidnight,
  clearCompanyChecksCache,
};
