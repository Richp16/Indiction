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

    if (status === 401 || status === 403) {
      const mapped = new Error(`${prefix}Paychex auth error (${status}): ${bodyStr}`);
      mapped.paychexErrorType = 'auth';
      mapped.statusCode = status;
      mapped.cause = err;
      return mapped;
    }

    if (status >= 500) {
      const mapped = new Error(`${prefix}Paychex server error (${status}): ${bodyStr}`);
      mapped.paychexErrorType = 'server';
      mapped.statusCode = status;
      mapped.cause = err;
      return mapped;
    }

    const mapped = new Error(`${prefix}Paychex HTTP ${status}: ${bodyStr}`);
    mapped.paychexErrorType = 'client';
    mapped.statusCode = status;
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
  };
}

module.exports = {
  mapPaychexError,
  isRetryableNetworkError,
  formatPaychexErrorForLog,
  RETRYABLE_NETWORK_CODES,
};
