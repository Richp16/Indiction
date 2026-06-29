const axios = require('axios');

let cachedToken = null;
let tokenExpiry = 0;

async function getToken() {
  const fiveMinutesMs = 5 * 60 * 1000;
  if (cachedToken && tokenExpiry - Date.now() > fiveMinutesMs) {
    return cachedToken;
  }

  const baseUrl = process.env.PAYCHEX_BASE_URL;
  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: process.env.PAYCHEX_CLIENT_ID,
    client_secret: process.env.PAYCHEX_CLIENT_SECRET,
  });

  try {
    const response = await axios.post(
      `${baseUrl}/auth/oauth/v2/token`,
      params.toString(),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }
    );

    cachedToken = response.data.access_token;
    tokenExpiry = Date.now() + response.data.expires_in * 1000;
    return cachedToken;
  } catch (error) {
    const detail = error.response?.data?.message || error.message;
    throw new Error(`Paychex authentication failed: ${detail}`);
  }
}

module.exports = { getToken };
