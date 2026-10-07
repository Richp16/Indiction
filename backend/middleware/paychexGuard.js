const { query } = require('../db');

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
    const message = String(error?.message || '');
    if (!message.includes('paychex_enabled')) {
      console.warn('[paychexGuard] paychex lookup failed:', error.message);
    }
  }

  return true;
}

function buildCapabilities(paychexEnabled) {
  const local = !paychexEnabled;
  return {
    workerSource: paychexEnabled ? 'paychex' : 'local',
    payPeriodSource: paychexEnabled ? 'paychex' : 'local',
    supportsProviderSync: paychexEnabled,
    supportsProviderSubmission: paychexEnabled,
    supportsProviderCheckData: paychexEnabled,
    supportsLocalPayrollExport: local,
    supportsTimeEntryImport: local,
    supportsManualTaxEntry: local,
    supportsManageEmployees: local,
    supportsSpiExport: paychexEnabled,
  };
}

async function getAppConfig() {
  const paychexEnabled = await isPaychexEnabled();
  let integrationConfigured = true;

  try {
    const result = await query(
      `SELECT integration_configured
       FROM company_settings
       ORDER BY id
       LIMIT 1`
    );
    if (result.rows[0] && typeof result.rows[0].integration_configured === 'boolean') {
      integrationConfigured = result.rows[0].integration_configured;
    }
  } catch (error) {
    const message = String(error?.message || '');
    if (!message.includes('integration_configured')) {
      console.warn('[paychexGuard] integration lookup failed:', error.message);
    }
  }

  return {
    paychexEnabled,
    integrationConfigured,
    capabilities: buildCapabilities(paychexEnabled),
  };
}

async function requirePaychexEnabled(req, res, next) {
  try {
    if (await isPaychexEnabled()) {
      return next();
    }
    return res.status(403).json({
      code: 'PAYCHEX_DISABLED',
      message: 'Paychex integration is disabled for this account',
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
}

async function requirePaychexDisabled(req, res, next) {
  try {
    if (!(await isPaychexEnabled())) {
      return next();
    }
    return res.status(403).json({
      code: 'PAYCHEX_ENABLED',
      message: 'This action is only available in Non-Paychex mode',
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
}

module.exports = {
  isPaychexEnabled,
  getAppConfig,
  buildCapabilities,
  requirePaychexEnabled,
  requirePaychexDisabled,
  parseEnabledFlag,
};
