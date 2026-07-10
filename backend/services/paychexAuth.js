const axios = require('axios');
const https = require('https');
const { getPaychexBaseUrl, PAYCHEX_TIMEOUT_MS } = require('../config/paychexApi');
const { mapPaychexError } = require('./paychexErrors');

let cachedToken = null;
let tokenExpiry = 0;

const authHttpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 10,
});

const authHttp = axios.create({
  baseURL: getPaychexBaseUrl(),
  timeout: PAYCHEX_TIMEOUT_MS,
  httpsAgent: authHttpsAgent,
});

function clearTokenCache() {
  cachedToken = null;
  tokenExpiry = 0;
}

async function getToken() {
  const fiveMinutesMs = 5 * 60 * 1000;
  if (cachedToken && tokenExpiry - Date.now() > fiveMinutesMs) {
    return cachedToken;
  }

  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: process.env.PAYCHEX_CLIENT_ID,
    client_secret: process.env.PAYCHEX_CLIENT_SECRET,
  });

  try {
    const response = await authHttp.post('/auth/oauth/v2/token', params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    cachedToken = response.data.access_token;
    tokenExpiry = Date.now() + response.data.expires_in * 1000;
    return cachedToken;
  } catch (error) {
    throw mapPaychexError(error, 'OAuth token request');
  }
}

module.exports = { getToken, clearTokenCache };
