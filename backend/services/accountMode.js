const {
  isPaychexEnabled,
  getAppConfig,
  parseEnabledFlag,
} = require('../middleware/paychexGuard');

/** @deprecated Use getAppConfig */
async function getAccountFeatures() {
  const config = await getAppConfig();
  return { paychexEnabled: config.paychexEnabled };
}

module.exports = {
  isPaychexEnabled,
  getAppConfig,
  getAccountFeatures,
  parseEnabledFlag,
};
