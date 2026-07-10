/**
 * Paychex API environment and HTTP client configuration.
 */

const PAYCHEX_ENV_URLS = {
  production: 'https://api.paychex.com',
  sandbox: 'https://sandbox.api.paychex.com',
};

function getPaychexBaseUrl() {
  const explicit = process.env.PAYCHEX_BASE_URL;
  if (explicit && explicit.trim()) {
    return explicit.trim().replace(/\/$/, '');
  }

  const env = (process.env.PAYCHEX_ENV || 'production').toLowerCase();
  return PAYCHEX_ENV_URLS[env] || PAYCHEX_ENV_URLS.production;
}

const PAYCHEX_TIMEOUT_MS = Number(process.env.PAYCHEX_TIMEOUT_MS ?? 30000);
const PAYCHEX_GET_MAX_RETRIES = Number(process.env.PAYCHEX_GET_MAX_RETRIES ?? 3);

function companyId() {
  return process.env.PAYCHEX_COMPANY_ID;
}

module.exports = {
  PAYCHEX_ENV_URLS,
  getPaychexBaseUrl,
  PAYCHEX_TIMEOUT_MS,
  PAYCHEX_GET_MAX_RETRIES,
  companyId,
};
