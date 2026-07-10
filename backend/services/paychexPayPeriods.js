const { companyId } = require('../config/paychexApi');
const { paychexGet } = require('./paychexHttp');

const CLOSED_PERIODS_LIMIT = 10;
const HISTORY_MONTHS = 6;

const DATE_PARAM_VARIANTS = [
  { label: 'startDate/endDate', startKey: 'startDate', endKey: 'endDate' },
  { label: 'start/end', startKey: 'start', endKey: 'end' },
  { label: 'fromDate/toDate', startKey: 'fromDate', endKey: 'toDate' },
  {
    label: 'processingPeriodStartDate/processingPeriodEndDate',
    startKey: 'processingPeriodStartDate',
    endKey: 'processingPeriodEndDate',
  },
  { label: 'from/to', startKey: 'from', endKey: 'to' },
];

const PROCESSED_STATUSES = new Set(['PROCESSED', 'COMPLETE', 'CLOSED']);

function parsePaychexDateString(value) {
  if (!value) return null;
  const dateStr = String(value).split('T')[0];
  const date = new Date(`${dateStr}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function todayUtcMidnight() {
  const today = new Date();
  return new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
}

function buildHistoryDateWindow() {
  const today = new Date();
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - HISTORY_MONTHS);

  return {
    startDate: sixMonthsAgo.toISOString().split('T')[0],
    endDate: today.toISOString().split('T')[0],
  };
}

function normalizePayPeriod(period) {
  if (!period) return null;

  const payPeriodId =
    period.payPeriodId ||
    period.processingPeriodId ||
    period.originalPayPeriodID ||
    period.originalPayPeriodId;

  const startDate =
    period.startDate ||
    period.processingPeriodStartDate ||
    period.periodStartDate;
  const endDate =
    period.endDate ||
    period.processingPeriodEndDate ||
    period.periodEndDate;

  if (!payPeriodId || !startDate || !endDate) return null;

  return {
    payPeriodId,
    startDate,
    endDate,
    status: period.status,
    sourceIdField: period.payPeriodId
      ? 'payPeriodId'
      : period.processingPeriodId
        ? 'processingPeriodId'
        : 'originalPayPeriodID',
  };
}

function summarizePayPeriods(payPeriods) {
  return {
    count: payPeriods.length,
    statuses: [...new Set(payPeriods.map((period) => period.status).filter(Boolean))],
    periods: payPeriods.map((period) => ({
      id: period.payPeriodId,
      startDate: period.startDate,
      endDate: period.endDate,
      status: period.status,
      sourceIdField: period.sourceIdField,
    })),
  };
}

function logRawPaychexPayPeriods(payPeriods, label = 'Raw Paychex response') {
  console.log(`[PayPeriods] ${label}:`, summarizePayPeriods(payPeriods));
}

function isClosedByEndDate(period) {
  const end = parsePaychexDateString(period.endDate);
  if (!end) return false;
  return end < todayUtcMidnight();
}

function isProcessedStatus(period) {
  const status = String(period.status || '').toUpperCase();
  return PROCESSED_STATUSES.has(status);
}

function hasHistoricalPeriods(payPeriods) {
  return payPeriods.some((period) => isClosedByEndDate(period) || isProcessedStatus(period));
}

function countClosedPayPeriods(payPeriods) {
  return payPeriods.filter((period) => isClosedByEndDate(period)).length;
}

function buildPayPeriodsPath(endpoint, variant, dateWindow) {
  const params = new URLSearchParams({
    [variant.startKey]: dateWindow.startDate,
    [variant.endKey]: dateWindow.endDate,
  });
  return `/companies/${companyId()}/${endpoint}?${params.toString()}`;
}

async function fetchPayPeriodsWithVariant(endpoint, variant, dateWindow) {
  const path = buildPayPeriodsPath(endpoint, variant, dateWindow);

  try {
    const rawItems = await paychexGet(path);
    const payPeriods = rawItems.map(normalizePayPeriod).filter(Boolean);

    console.log(`[PayPeriods] ${endpoint} ${variant.label}:`, {
      count: payPeriods.length,
      statuses: [...new Set(payPeriods.map((period) => period.status).filter(Boolean))],
      closedByEndDate: countClosedPayPeriods(payPeriods),
      hasHistorical: hasHistoricalPeriods(payPeriods),
    });

    return payPeriods;
  } catch (error) {
    console.warn(
      `[PayPeriods] ${endpoint} ${variant.label} failed:`,
      error.message
    );
    return null;
  }
}

async function discoverPayPeriodsFromEndpoint(endpoint, dateWindow) {
  let bestAttempt = { payPeriods: [], variant: null };

  for (const variant of DATE_PARAM_VARIANTS) {
    const payPeriods = await fetchPayPeriodsWithVariant(endpoint, variant, dateWindow);
    if (!payPeriods) continue;

    if (hasHistoricalPeriods(payPeriods)) {
      console.log(`[PayPeriods] Using ${endpoint} with ${variant.label}`);
      return { endpoint, variant: variant.label, payPeriods };
    }

    if (payPeriods.length > bestAttempt.payPeriods.length) {
      bestAttempt = { payPeriods, variant: variant.label };
    }
  }

  if (bestAttempt.payPeriods.length > 0) {
    console.warn(
      `[PayPeriods] ${endpoint} returned no historical periods; ` +
        `using largest response (${bestAttempt.variant}, count=${bestAttempt.payPeriods.length})`
    );
    return {
      endpoint,
      variant: bestAttempt.variant,
      payPeriods: bestAttempt.payPeriods,
    };
  }

  return { endpoint, variant: null, payPeriods: [] };
}

function choosePayPeriodSource(payPeriodsResult, processingPeriodsResult) {
  const payHasHistorical = hasHistoricalPeriods(payPeriodsResult.payPeriods);
  const processingHasHistorical = hasHistoricalPeriods(processingPeriodsResult.payPeriods);

  console.log('[PayPeriods] Endpoint comparison:', {
    payperiods: {
      count: payPeriodsResult.payPeriods.length,
      closedByEndDate: countClosedPayPeriods(payPeriodsResult.payPeriods),
      statuses: [...new Set(payPeriodsResult.payPeriods.map((period) => period.status).filter(Boolean))],
      variant: payPeriodsResult.variant,
    },
    processingperiods: {
      count: processingPeriodsResult.payPeriods.length,
      closedByEndDate: countClosedPayPeriods(processingPeriodsResult.payPeriods),
      statuses: [
        ...new Set(processingPeriodsResult.payPeriods.map((period) => period.status).filter(Boolean)),
      ],
      variant: processingPeriodsResult.variant,
    },
  });

  if (processingHasHistorical && !payHasHistorical) {
    console.log('[PayPeriods] Switching to processingperiods — only source with historical data');
    return processingPeriodsResult;
  }

  if (processingHasHistorical && payHasHistorical) {
    const payClosed = countClosedPayPeriods(payPeriodsResult.payPeriods);
    const processingClosed = countClosedPayPeriods(processingPeriodsResult.payPeriods);

    if (processingClosed > payClosed) {
      console.log('[PayPeriods] Switching to processingperiods — more closed periods');
      return processingPeriodsResult;
    }
  }

  return payPeriodsResult;
}

function filterClosedPayPeriods(payPeriods) {
  const closed = payPeriods.filter((period) => {
    const end = parsePaychexDateString(period.endDate);
    if (!end) {
      console.warn(
        '[PayPeriods] Skipping period with unparseable endDate:',
        period.endDate,
        period.payPeriodId
      );
      return false;
    }
    return end < todayUtcMidnight();
  });

  console.log('[PayPeriods] After closed filter:', { count: closed.length });

  return closed
    .sort((a, b) => parsePaychexDateString(b.endDate) - parsePaychexDateString(a.endDate))
    .slice(0, CLOSED_PERIODS_LIMIT);
}

async function fetchPaychexPayPeriods() {
  const dateWindow = buildHistoryDateWindow();
  console.log('[PayPeriods] Fetching with date window:', dateWindow);

  const payPeriodsResult = await discoverPayPeriodsFromEndpoint('payperiods', dateWindow);
  const processingPeriodsResult = await discoverPayPeriodsFromEndpoint(
    'processingperiods',
    dateWindow
  );

  const selected = choosePayPeriodSource(payPeriodsResult, processingPeriodsResult);
  logRawPaychexPayPeriods(
    selected.payPeriods,
    `Selected source: ${selected.endpoint} (${selected.variant || 'none'})`
  );

  const recentClosed = filterClosedPayPeriods(selected.payPeriods);
  console.log('[PayPeriods] Returning recent closed periods:', {
    count: recentClosed.length,
    source: selected.endpoint,
    variant: selected.variant,
  });

  return recentClosed;
}

module.exports = {
  CLOSED_PERIODS_LIMIT,
  HISTORY_MONTHS,
  DATE_PARAM_VARIANTS,
  parsePaychexDateString,
  todayUtcMidnight,
  buildHistoryDateWindow,
  normalizePayPeriod,
  hasHistoricalPeriods,
  countClosedPayPeriods,
  filterClosedPayPeriods,
  buildPayPeriodsPath,
  fetchPaychexPayPeriods,
  logRawPaychexPayPeriods,
};
