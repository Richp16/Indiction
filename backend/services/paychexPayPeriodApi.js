/**
 * Paychex pay-period and checks API client.
 *
 * payPeriodId must come from GET /companies/{companyId}/payperiods.
 * Do not derive or invent it. Never pass workerId or paycheckId as payperiodid.
 */

const paychexHttp = require('./paychexHttp');
const {
  formatPaychexErrorForLog,
  extractPaychexErrorCode,
  CHECKS_SERVER_ERROR_MESSAGE,
  CHECKS_NOT_READY_MESSAGE,
  isChecksReadyStatus,
} = require('./paychexErrors');
const {
  assertPaychexCompanyId,
  assertPaychexPayPeriodId,
  assertPaychexWorkerId,
} = require('./paychexIds');

async function lookupLocalPeriod(companyId, payPeriodId) {
  if (!companyId || !payPeriodId) return null;
  try {
    // Lazy require avoids circular dependency with paychexPayPeriodStore.
    const { findLocalPayPeriod } = require('./paychexPayPeriodStore');
    return await findLocalPayPeriod(companyId, payPeriodId);
  } catch {
    return null;
  }
}

function parseDateOnly(value) {
  if (!value) return null;
  return String(value).split('T')[0];
}

/** Strip milliseconds: 2026-07-21T18:47:07.783Z → 2026-07-21T18:47:07Z */
function toIsoNoMs(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Default Paychex payperiods date window: start of day one year ago → end of today (UTC).
 * Paychex rejects millisecond timestamps ("The date range requires both start and end dates.").
 *
 * @param {Date} [now]
 * @returns {{ from: string, to: string }}
 */
function buildPaychexDateRange(now = new Date()) {
  const fromDate = new Date(
    Date.UTC(now.getUTCFullYear() - 1, now.getUTCMonth(), now.getUTCDate(), 0, 0, 0)
  );
  const toDate = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59)
  );

  return {
    from: toIsoNoMs(fromDate),
    to: toIsoNoMs(toDate),
  };
}

/**
 * Normalize an arbitrary from/to into full-day UTC bounds without milliseconds.
 * from → YYYY-MM-DDT00:00:00Z, to → YYYY-MM-DDT23:59:59Z
 */
function normalizePaychexDateBounds(from, to) {
  const fromDay = parseDateOnly(from);
  const toDay = parseDateOnly(to);
  if (!fromDay || !toDay) {
    return buildPaychexDateRange();
  }

  const fromDate = new Date(`${fromDay}T00:00:00.000Z`);
  const toDate = new Date(`${toDay}T23:59:59.000Z`);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    return buildPaychexDateRange();
  }

  return {
    from: toIsoNoMs(fromDate),
    to: toIsoNoMs(toDate),
  };
}

function toNumberOrNull(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function buildStatusQuery(statuses) {
  const list = Array.isArray(statuses) ? statuses : [statuses];
  return list
    .map((status) => String(status || '').trim())
    .filter(Boolean)
    .map((status) => `status=${encodeURIComponent(status)}`)
    .join('&');
}

/**
 * Normalize a Paychex pay period resource.
 * @param {object} raw
 */
function normalizePayPeriod(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const payPeriodId = raw.payPeriodId != null ? String(raw.payPeriodId) : null;
  if (!payPeriodId) return null;

  return {
    payPeriodId,
    intervalCode: raw.intervalCode || raw.payPeriodIntervalCode || null,
    status: raw.status || null,
    description: raw.description || raw.payPeriodDescription || null,
    startDate: parseDateOnly(raw.startDate),
    endDate: parseDateOnly(raw.endDate),
    submitByDate: parseDateOnly(raw.submitByDate),
    checkDate: parseDateOnly(raw.checkDate || raw.payDate),
    checkCount: toNumberOrNull(raw.checkCount ?? raw.checksCount),
    raw,
  };
}

function normalizeEarning(earning) {
  if (!earning || typeof earning !== 'object') return null;
  return {
    componentId: earning.componentId ?? null,
    checkComponentId: earning.checkComponentId ?? null,
    name: earning.name ?? earning.componentName ?? null,
    classificationType: earning.classificationType ?? null,
    effectOnPay: earning.effectOnPay ?? null,
    memoed: earning.memoed ?? null,
    organization: earning.organization ?? null,
    jobName: earning.jobName ?? earning.job?.name ?? null,
    jobId: earning.jobId ?? earning.job?.jobId ?? null,
    amount: toNumberOrNull(earning.amount ?? earning.value ?? earning.payAmount),
    rate: toNumberOrNull(earning.rate),
    hours: toNumberOrNull(earning.hours ?? earning.units),
  };
}

/**
 * Normalize a Paychex check resource for API responses.
 * @param {object} raw
 * @param {string} [fallbackPayPeriodId]
 */
function normalizeCheck(raw, fallbackPayPeriodId = null) {
  if (!raw || typeof raw !== 'object') return null;

  const earnings = (raw.earnings || raw.payComponents || [])
    .map(normalizeEarning)
    .filter(Boolean);

  return {
    payPeriodId:
      raw.payPeriodId != null
        ? String(raw.payPeriodId)
        : raw.payPeriod?.payPeriodId != null
          ? String(raw.payPeriod.payPeriodId)
          : fallbackPayPeriodId,
    paycheckId:
      raw.paycheckId != null
        ? String(raw.paycheckId)
        : raw.checkId != null
          ? String(raw.checkId)
          : null,
    workerId:
      raw.workerId != null
        ? String(raw.workerId)
        : raw.worker?.workerId != null
          ? String(raw.worker.workerId)
          : null,
    checkDate: parseDateOnly(raw.checkDate || raw.payDate),
    netPay: toNumberOrNull(raw.netPay ?? raw.netEarnings ?? raw.netPayAmount),
    checkType: raw.checkType || raw.type || null,
    checkNumber: raw.checkNumber != null ? String(raw.checkNumber) : null,
    earnings,
    deductions: Array.isArray(raw.deductions) ? raw.deductions : raw.benefitDeductions || [],
    taxes: Array.isArray(raw.taxes) ? raw.taxes : raw.taxWithholdings || [],
    raw,
  };
}

function enrichPaychexError(error, context) {
  const mapped = error;
  mapped.paychexContext = context;
  mapped.paychexErrorCode = extractPaychexErrorCode(mapped);
  if (mapped.statusCode === 404 || mapped.statusCode === 400) {
    mapped.code = mapped.code || 'PAYCHEX_NOT_FOUND';
  }
  return mapped;
}

/**
 * Log full Paychex failure details, then replace the client-facing message for
 * checks failures. Draft/pending periods get CHECKS_NOT_READY instead of a raw 500.
 */
async function handleChecksFetchError(error, context) {
  const enriched = enrichPaychexError(error, context);
  const { companyId, payPeriodId, workerId, endpoint } = context;

  let localPeriod = null;
  if (companyId && payPeriodId) {
    localPeriod = await lookupLocalPeriod(companyId, payPeriodId);
  }

  const periodStatus = localPeriod?.status || null;
  const checksReady = isChecksReadyStatus(periodStatus);

  console.error('[Paychex] checks fetch failed', {
    companyId: companyId || null,
    workerId: workerId || null,
    payPeriodId: payPeriodId || null,
    endpoint,
    periodStatus,
    checksReady,
    statusCode: enriched.statusCode,
    paychexErrorCode: enriched.paychexErrorCode,
    error: formatPaychexErrorForLog(enriched),
  });

  // Draft / non-finalized payroll: expected that /checks may 500 or return empty profiles.
  if (
    (enriched.statusCode >= 500 || enriched.paychexErrorType === 'server') &&
    periodStatus &&
    !checksReady
  ) {
    const clientError = new Error(CHECKS_NOT_READY_MESSAGE);
    clientError.statusCode = 409;
    clientError.code = 'CHECKS_NOT_READY';
    clientError.paychexErrorCode = enriched.paychexErrorCode || 'API-1';
    clientError.paychexErrorType = 'checks_not_ready';
    clientError.paychexContext = {
      ...enriched.paychexContext,
      periodStatus,
    };
    clientError.cause = enriched;
    return clientError;
  }

  if (enriched.statusCode >= 500 || enriched.paychexErrorType === 'server') {
    const clientError = new Error(CHECKS_SERVER_ERROR_MESSAGE);
    clientError.statusCode = enriched.statusCode || 500;
    clientError.code = enriched.paychexErrorCode || 'API-1';
    clientError.paychexErrorCode = enriched.paychexErrorCode || 'API-1';
    clientError.paychexErrorType = 'server';
    clientError.paychexContext = {
      ...enriched.paychexContext,
      periodStatus,
    };
    clientError.cause = enriched;
    return clientError;
  }

  return enriched;
}

/** @deprecated Use handleChecksFetchError */
async function handleCompanyChecksError(error, context) {
  return handleChecksFetchError(error, context);
}

/**
 * GET /companies/{companyId}/payperiods?from=&to=&status=
 *
 * payPeriodId values returned here are the only IDs safe to use for /checks.
 * from/to are normalized to full-day UTC without milliseconds (Paychex requirement).
 *
 * @param {{ companyId: string, from?: string, to?: string, status?: string[] }} params
 */
async function getCompanyPayPeriods({ companyId, from, to, status = ['COMPLETED'] }) {
  const cid = assertPaychexCompanyId(companyId);
  const bounds =
    from && to ? normalizePaychexDateBounds(from, to) : buildPaychexDateRange();
  const fromIso = bounds.from;
  const toIso = bounds.to;

  const statusQuery = buildStatusQuery(status);
  const path =
    `/companies/${encodeURIComponent(cid)}/payperiods` +
    `?from=${encodeURIComponent(fromIso)}` +
    `&to=${encodeURIComponent(toIso)}` +
    (statusQuery ? `&${statusQuery}` : '');

  console.log('[Paychex] Fetching company pay periods', {
    companyId: cid,
    from: fromIso,
    to: toIso,
    statuses: status,
  });

  try {
    const content = await paychexHttp.paychexGet(path, { companyId: cid });
    const periods = (Array.isArray(content) ? content : [])
      .map(normalizePayPeriod)
      .filter(Boolean);

    console.log('[Paychex] Company pay periods fetched', {
      companyId: cid,
      count: periods.length,
    });

    return periods;
  } catch (error) {
    console.error('[Paychex] getCompanyPayPeriods failed', {
      companyId: cid,
      from: fromIso,
      to: toIso,
      endpoint: path.split('?')[0],
      error: formatPaychexErrorForLog(error),
    });
    throw enrichPaychexError(error, { companyId: cid, endpoint: 'payperiods' });
  }
}

/**
 * GET /companies/{companyId}/checks?payperiodid={payPeriodId}
 *
 * payPeriodId must come from GET /companies/{companyId}/payperiods — do not invent it.
 *
 * @param {{ companyId: string, payPeriodId: string }} params
 */
async function getCompanyChecksByPayPeriod({ companyId, payPeriodId }) {
  const cid = assertPaychexCompanyId(companyId);
  // payPeriodId must come from GET /companies/{companyId}/payperiods — do not invent it.
  const pid = assertPaychexPayPeriodId(payPeriodId);

  const path =
    `/companies/${encodeURIComponent(cid)}/checks` +
    `?payperiodid=${encodeURIComponent(pid)}`;

  console.log('[Paychex] Fetching company checks', { companyId: cid, payPeriodId: pid });

  try {
    // Do not send offset/limit — Paychex /checks has returned API-1 500 with pagination.
    const content = await paychexHttp.paychexGet(path, {
      companyId: cid,
      payPeriodId: pid,
      paginate: false,
    });
    const checks = (Array.isArray(content) ? content : [])
      .map((check) => normalizeCheck(check, pid))
      .filter(Boolean);

    console.log('[Paychex] Company checks fetched', {
      companyId: cid,
      payPeriodId: pid,
      count: checks.length,
    });

    return checks;
  } catch (error) {
    throw await handleChecksFetchError(error, {
      companyId: cid,
      payPeriodId: pid,
      endpoint: path.split('?')[0],
    });
  }
}

/**
 * GET /workers/{workerId}/checks?payperiodid={payPeriodId}
 *
 * payPeriodId must come from GET /companies/{companyId}/payperiods — do not invent it.
 * workerId goes in the path; payPeriodId goes only in the query.
 *
 * @param {{ workerId: string, payPeriodId: string, companyId?: string }} params
 */
async function getWorkerChecksByPayPeriod({ workerId, payPeriodId, companyId }) {
  const wid = assertPaychexWorkerId(workerId);
  // payPeriodId must come from GET /companies/{companyId}/payperiods — do not invent it.
  const pid = assertPaychexPayPeriodId(payPeriodId);

  const path =
    `/workers/${encodeURIComponent(wid)}/checks` +
    `?payperiodid=${encodeURIComponent(pid)}`;

  console.log('[Paychex] Fetching worker checks', { workerId: wid, payPeriodId: pid });

  try {
    // Accept: */* + no pagination applied inside paychexGet for /checks paths.
    const content = await paychexHttp.paychexGet(path, {
      workerId: wid,
      payPeriodId: pid,
      paginate: false,
    });
    const checks = (Array.isArray(content) ? content : [])
      .map((check) => normalizeCheck(check, pid))
      .filter(Boolean);

    console.log('[Paychex] Worker checks fetched', {
      workerId: wid,
      payPeriodId: pid,
      count: checks.length,
    });

    return checks;
  } catch (error) {
    throw await handleChecksFetchError(error, {
      companyId: companyId || null,
      workerId: wid,
      payPeriodId: pid,
      endpoint: path.split('?')[0],
    });
  }
}

/**
 * Build the exact request path strings (for tests / diagnostics).
 * Does not invent IDs — callers must supply validated ones.
 */
function buildCompanyChecksPath(companyId, payPeriodId) {
  const cid = assertPaychexCompanyId(companyId);
  const pid = assertPaychexPayPeriodId(payPeriodId);
  return `/companies/${cid}/checks?payperiodid=${pid}`;
}

function buildWorkerChecksPath(workerId, payPeriodId) {
  const wid = assertPaychexWorkerId(workerId);
  const pid = assertPaychexPayPeriodId(payPeriodId);
  return `/workers/${wid}/checks?payperiodid=${pid}`;
}

function buildCompanyPayPeriodsPath(companyId, { from, to, status = ['COMPLETED'] } = {}) {
  const cid = assertPaychexCompanyId(companyId);
  const bounds =
    from && to ? normalizePaychexDateBounds(from, to) : buildPaychexDateRange();
  const statusQuery = buildStatusQuery(status);
  return (
    `/companies/${cid}/payperiods` +
    `?from=${encodeURIComponent(bounds.from)}` +
    `&to=${encodeURIComponent(bounds.to)}` +
    (statusQuery ? `&${statusQuery}` : '')
  );
}

module.exports = {
  toIsoNoMs,
  buildPaychexDateRange,
  normalizePaychexDateBounds,
  normalizePayPeriod,
  normalizeCheck,
  normalizeEarning,
  getCompanyPayPeriods,
  getCompanyChecksByPayPeriod,
  getWorkerChecksByPayPeriod,
  buildCompanyChecksPath,
  buildWorkerChecksPath,
  buildCompanyPayPeriodsPath,
};
