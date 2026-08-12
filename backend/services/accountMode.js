const { query } = require('../db');

/**
 * Account / deployment feature flags.
 *
 * Non-Paychex mode: set PAYCHEX_ENABLED=false, or company_settings.paychex_enabled
 * when that column exists. Defaults to enabled so existing Paychex deployments
 * keep current behavior.
 */
function parseEnabledFlag(raw) {
  if (raw == null || String(raw).trim() === '') return null;
  return !['0', 'false', 'no', 'off'].includes(String(raw).trim().toLowerCase());
}

async function isPaychexEnabled() {
  const fromEnv = parseEnabledFlag(process.env.PAYCHEX_ENABLED);
  if (fromEnv != null) return fromEnv;

  try {
    const result = await query(
      `SELECT paychex_enabled
       FROM company_settings
       ORDER BY id
       LIMIT 1`
    );
    if (result.rows[0] && typeof result.rows[0].paychex_enabled === 'boolean') {
      return result.rows[0].paychex_enabled;
    }
  } catch (error) {
    // Column may not exist yet — treat as enabled.
    const message = String(error?.message || '');
    if (!message.includes('paychex_enabled')) {
      console.warn('[accountMode] paychex lookup failed:', error.message);
    }
  }

  return true;
}

async function getAccountFeatures() {
  return {
    paychexEnabled: await isPaychexEnabled(),
  };
}

module.exports = {
  isPaychexEnabled,
  getAccountFeatures,
  parseEnabledFlag,
};
