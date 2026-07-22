const https = require('https');
const axios = require('axios');
const {
  getPaychexBaseUrl,
  PAYCHEX_TIMEOUT_MS,
  PAYCHEX_GET_MAX_RETRIES,
  companyId,
} = require('../config/paychexApi');
const {
  mapPaychexError,
  isRetryableNetworkError,
  formatPaychexErrorForLog,
} = require('./paychexErrors');
const { getToken, clearTokenCache } = require('./paychexAuth');

const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 50,
});

const paychexHttp = axios.create({
  baseURL: getPaychexBaseUrl(),
  timeout: PAYCHEX_TIMEOUT_MS,
  httpsAgent,
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function logGetRequest(path, extra = {}) {
  console.log(
    `[paychex] GET ${getPaychexBaseUrl()}${path} timeoutMs=${PAYCHEX_TIMEOUT_MS}`,
    extra.workerId ? `workerId=${extra.workerId}` : ''
  );
}

async function authorizedRequest(method, path, options = {}) {
  const token = await getToken();
  return paychexHttp.request({
    method,
    url: path,
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });
}

async function paychexGetWithRetry(path, logContext = '') {
  let lastError;

  for (let attempt = 1; attempt <= PAYCHEX_GET_MAX_RETRIES; attempt += 1) {
    try {
      const response = await authorizedRequest('get', path);
      return response;
    } catch (err) {
      lastError = err;

      if (err.response?.status === 401 && attempt < PAYCHEX_GET_MAX_RETRIES) {
        clearTokenCache();
        console.warn('[paychex] Token rejected (401), refreshing and retrying');
        continue;
      }

      if (!isRetryableNetworkError(err) || attempt >= PAYCHEX_GET_MAX_RETRIES) {
        throw mapPaychexError(err, logContext);
      }

      const backoffMs = 500 * attempt;
      console.warn(
        `[paychex] GET ${path} network error (${err.code}), ` +
          `retry ${attempt}/${PAYCHEX_GET_MAX_RETRIES} in ${backoffMs}ms`
      );
      await sleep(backoffMs);
    }
  }

  throw mapPaychexError(lastError, logContext);
}

/**
 * Single-page GET (no offset/limit). Use for endpoints that reject pagination
 * (notably GET .../checks?payperiodid=...).
 */
async function paychexGetOnce(path, logOptions = {}) {
  logGetRequest(path, logOptions);
  const response = await paychexGetWithRetry(path, `GET ${path}`);
  return response.data.content || [];
}

/**
 * Paginated GET helper for Paychex list endpoints.
 *
 * Pass `{ paginate: false }` to call the path exactly as given (no offset/limit).
 * Required for /checks until Paychex confirms pagination support.
 */
async function paychexGet(path, logOptions = {}) {
  if (logOptions.paginate === false) {
    return paychexGetOnce(path, logOptions);
  }

  const items = [];
  let offset = 0;
  const limit = 100;
  let hasMore = true;

  while (hasMore) {
    const separator = path.includes('?') ? '&' : '?';
    const pagePath = `${path}${separator}offset=${offset}&limit=${limit}`;
    logGetRequest(pagePath, logOptions);

    const response = await paychexGetWithRetry(pagePath, `GET ${pagePath}`);
    const content = response.data.content || [];
    items.push(...content);

    const pagination = response.data.metadata?.pagination;
    if (pagination && pagination.itemCount > offset + limit) {
      offset += limit;
    } else {
      hasMore = false;
    }
  }

  return items;
}

async function paychexPost(path, body, logContext = '') {
  try {
    const response = await authorizedRequest('post', path, {
      data: body,
      headers: { 'Content-Type': 'application/json' },
    });
    return response.data;
  } catch (err) {
    throw mapPaychexError(err, logContext || `POST ${path}`);
  }
}

async function checkPaychexConnectivity() {
  const baseUrl = getPaychexBaseUrl();
  const cid = companyId();
  const path = cid ? `/companies/${cid}` : '/companies';
  const started = Date.now();

  try {
    const response = await paychexGetWithRetry(path, 'connectivity check');
    const latencyMs = Date.now() - started;
    return {
      ok: true,
      message: `Paychex connectivity OK (status ${response.status}, latency ${latencyMs} ms)`,
      latencyMs,
      baseUrl,
      status: response.status,
    };
  } catch (err) {
    const mapped = err.paychexErrorType ? err : mapPaychexError(err, 'connectivity check');
    return {
      ok: false,
      message: `Paychex connectivity FAILED: ${mapped.message}`,
      baseUrl,
      error: formatPaychexErrorForLog(mapped),
    };
  }
}

module.exports = {
  paychexHttp,
  paychexGet,
  paychexGetOnce,
  paychexPost,
  paychexGetWithRetry,
  checkPaychexConnectivity,
  getPaychexBaseUrl,
};
