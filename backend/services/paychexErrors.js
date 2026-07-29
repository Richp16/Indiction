/**
 * Classify Paychex / Axios errors into auth, HTTP, network, or unknown.
 */

const RETRYABLE_NETWORK_CODES = new Set([
  'ETIMEDOUT',
  'ECONNRESET',
  'ENETUNREACH',
  'ECONNREFUSED',
  'EAI_AGAIN',
  'ENOTFOUND',
]);

function serializeResponseBody(body) {
  if (body == null) return '';
  if (typeof body === 'string') return body;
  try {
    return JSON.stringify(body);
  } catch {
    return String(body);
  }
}

function mapPaychexError(err, context = '') {
  const prefix = context ? `${context}: ` : '';

  if (err?.response) {
    const status = err.response.status;
    const bodyStr = serializeResponseBody(err.response.data);
    const paychexErrorCode = extractPaychexErrorCodeFromBody(err.response.data);

    if (status === 401 || status === 403) {
      const mapped = new Error(`${prefix}Paychex auth error (${status}): ${bodyStr}`);
      mapped.paychexErrorType = 'auth';
      mapped.statusCode = status;
      mapped.paychexErrorCode = paychexErrorCode;
      mapped.cause = err;
      return mapped;
    }

    if (status >= 500) {
      const mapped = new Error(`${prefix}Paychex server error (${status}): ${bodyStr}`);
      mapped.paychexErrorType = 'server';
      mapped.statusCode = status;
      mapped.paychexErrorCode = paychexErrorCode || 'API-1';
      mapped.cause = err;
      return mapped;
    }

    const mapped = new Error(`${prefix}Paychex HTTP ${status}: ${bodyStr}`);
    mapped.paychexErrorType = 'client';
    mapped.statusCode = status;
    mapped.paychexErrorCode = paychexErrorCode;
    mapped.cause = err;
    return mapped;
  }

  const code = err?.code;
  if (code && RETRYABLE_NETWORK_CODES.has(code)) {
    const mapped = new Error(`${prefix}Paychex network error (${code}): ${err.message}`);
    mapped.paychexErrorType = 'network';
    mapped.networkCode = code;
    mapped.cause = err;
    return mapped;
  }

  const mapped = new Error(`${prefix}Paychex unknown error: ${err?.message || String(err)}`);
  mapped.paychexErrorType = 'unknown';
  mapped.cause = err;
  return mapped;
}

function extractPaychexErrorCodeFromBody(body) {
  if (!body) return null;
  if (typeof body === 'object') {
    if (body.code) return String(body.code);
    if (Array.isArray(body.errors) && body.errors[0]?.code) {
      return String(body.errors[0].code);
    }
    if (body.error?.code) return String(body.error.code);
  }
  const serialized = serializeResponseBody(body);
  const match = serialized.match(/\bAPI-\d+\b/i);
  return match ? match[0].toUpperCase() : null;
}

function isRetryableNetworkError(err) {
  if (err?.response) return false;
  return RETRYABLE_NETWORK_CODES.has(err?.code);
}

function formatPaychexErrorForLog(err) {
  return {
    type: err.paychexErrorType || 'unknown',
    message: err.message,
    statusCode: err.statusCode ?? err.response?.status,
    networkCode: err.networkCode || err.code,
    paychexErrorCode: err.paychexErrorCode || undefined,
    companyId: err.paychexContext?.companyId,
    payPeriodId: err.paychexContext?.payPeriodId,
  };
}

/**
 * Human-readable sync failure message for logs and admin UI banners.
 * Avoids dumping raw JSON response bodies.
 */
function formatSyncErrorForUser(error) {
  const type = error?.paychexErrorType || null;
  const status = error?.statusCode ?? error?.response?.status;

  if (type === 'auth' || status === 401 || status === 403) {
    return {
      type: 'auth',
      statusCode: status,
      message: 'Paychex API authentication failed',
    };
  }
  if (type === 'network' || (error?.code && !error?.response)) {
    const code = error.networkCode || error.code;
    return {
      type: 'network',
      networkCode: code,
      message: code
        ? `Could not reach Paychex API (${code})`
        : 'Could not reach Paychex API (network error)',
    };
  }
  if (type === 'server' || (status && status >= 500)) {
    return {
      type: 'server',
      statusCode: status,
      message: status
        ? `Paychex API server error (${status})`
        : 'Paychex API server error',
    };
  }
  if (status) {
    return {
      type: 'http',
      statusCode: status,
      message: `Paychex API request failed (HTTP ${status})`,
    };
  }

  if (error?.paychexErrorType || error?.paychexContext) {
    const logged = formatPaychexErrorForLog(error);
    const raw = String(logged.message || '');
    const cleaned = raw.replace(/:\s*[\[{][\s\S]*$/, '').trim();
    return {
      ...logged,
      message: cleaned || 'Paychex sync failed',
    };
  }

  return {
    type: 'unknown',
    message: error?.message || 'Unknown sync error',
  };
}

/**
 * Extract Paychex error code (e.g. "API-1") from a mapped error or raw body.
 */
function extractPaychexErrorCode(err) {
  if (err?.paychexErrorCode) return err.paychexErrorCode;

  const body = err?.cause?.response?.data ?? err?.response?.data ?? null;
  if (body) {
    const fromBody = extractPaychexErrorCodeFromBody(body);
    if (fromBody) return fromBody;
  }

  const match = String(err?.message || '').match(/\bAPI-\d+\b/i);
  return match ? match[0].toUpperCase() : null;
}

const CHECKS_SERVER_ERROR_MESSAGE =
  'Paychex returned a server error for this pay period. Try again later or contact Paychex API Developer Center Support.';

const CHECKS_NOT_READY_MESSAGE =
  'Checks not yet available — payroll period is still in draft/pending status (or Paychex has not finalized checks for this period).';

/** Paychex statuses where /checks is expected to succeed. */
const CHECKS_READY_STATUSES = new Set(['COMPLETED', 'PROCESSED', 'CLOSED', 'FINALIZED']);

function isChecksReadyStatus(status) {
  if (!status) return false;
  return CHECKS_READY_STATUSES.has(String(status).trim().toUpperCase());
}

module.exports = {
  mapPaychexError,
  isRetryableNetworkError,
  formatPaychexErrorForLog,
  formatSyncErrorForUser,
  extractPaychexErrorCode,
  CHECKS_SERVER_ERROR_MESSAGE,
  CHECKS_NOT_READY_MESSAGE,
  isChecksReadyStatus,
  CHECKS_READY_STATUSES,
  RETRYABLE_NETWORK_CODES,
};
