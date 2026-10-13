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
    return false;
  } catch (error) {
    const message = String(error?.message || '');
    if (!message.includes('paychex_enabled')) {
      console.warn('[paychexGuard] paychex lookup failed:', error.message);
    }
    // Databases that predate migration 018 have no mode column and are Paychex installs.
    return true;
  }
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

function missingPaychexCredentials() {
  return ['PAYCHEX_CLIENT_ID', 'PAYCHEX_CLIENT_SECRET', 'PAYCHEX_COMPANY_ID'].filter(
    (key) => !String(process.env[key] || '').trim()
  );
}

function safePaychexFailure(result) {
  const status = result?.error?.statusCode;
  const network = result?.error?.networkCode;
  if (network === 'ENOTFOUND' || network === 'EAI_AGAIN') {
    return 'Paychex host could not be resolved. Check PAYCHEX_ENV, PAYCHEX_BASE_URL, and DNS.';
  }
  if (network === 'ETIMEDOUT' || network === 'ECONNABORTED' || network === 'ECONNREFUSED' || network === 'ENETUNREACH' || network === 'ECONNRESET') {
    return `Paychex network error (${network}). Check PAYCHEX_ENV and that this machine can reach the Paychex API.`;
  }
  if (status === 400 || status === 401) {
    return 'Paychex rejected the client id or secret. Confirm the credentials match PAYCHEX_ENV (sandbox credentials only work against the sandbox host).';
  }
  if (status === 403) {
    return 'Paychex accepted the application but denied this company or endpoint. Ask Paychex to authorize the company and the workers, pay periods, checks, and pay components APIs.';
  }
  if (status === 404) {
    return 'Paychex could not find PAYCHEX_COMPANY_ID in this environment. Sandbox and production company ids are different.';
  }
  return 'Paychex connectivity check failed. Run npm run paychex:health in the backend folder for the status code.';
}

async function assertModeSelectionAllowed(wantPaychex) {
  const fromEnv = parseEnabledFlag(process.env.PAYCHEX_ENABLED);
  if (fromEnv === false && wantPaychex) {
    const error = new Error(
      'PAYCHEX_ENABLED is off in backend/.env, so Paychex mode cannot be selected. Remove it or set it to 1.'
    );
    error.statusCode = 409;
    error.code = 'PAYCHEX_ENV_OVERRIDE';
    throw error;
  }
  if (fromEnv === true && !wantPaychex) {
    const error = new Error(
      'PAYCHEX_ENABLED is on in backend/.env, so Non-Paychex mode cannot be selected. Remove it or set it to 0.'
    );
    error.statusCode = 409;
    error.code = 'PAYCHEX_ENV_OVERRIDE';
    throw error;
  }
  if (!wantPaychex) return;

  const missing = missingPaychexCredentials();
  if (missing.length > 0) {
    const error = new Error(
      `Paychex mode needs ${missing.join(', ')} in backend/.env. Set them and run npm run paychex:health before choosing Paychex.`
    );
    error.statusCode = 400;
    error.code = 'PAYCHEX_NOT_CONFIGURED';
    throw error;
  }

  const { checkPaychexConnectivity } = require('../services/paychexHttp');
  const connectivity = await checkPaychexConnectivity();
  if (!connectivity.ok) {
    const error = new Error(safePaychexFailure(connectivity));
    error.statusCode = 502;
    error.code = 'PAYCHEX_UNREACHABLE';
    throw error;
  }
}

async function getAppConfig() {
  const paychexEnabled = await isPaychexEnabled();
  let integrationConfigured = false;

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
    if (message.includes('integration_configured')) {
      integrationConfigured = true;
    } else {
      console.warn('[paychexGuard] integration lookup failed:', error.message);
      integrationConfigured = true;
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
  assertModeSelectionAllowed,
  missingPaychexCredentials,
  safePaychexFailure,
};
