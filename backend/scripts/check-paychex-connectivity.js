require('dotenv').config();
const { checkPaychexConnectivity, getPaychexBaseUrl } = require('../services/paychexHttp');
const { PAYCHEX_TIMEOUT_MS } = require('../config/paychexApi');

async function main() {
  console.log('Paychex config:', {
    baseURL: getPaychexBaseUrl(),
    timeoutMs: PAYCHEX_TIMEOUT_MS,
    companyId: process.env.PAYCHEX_COMPANY_ID ? '(set)' : '(missing)',
    env: process.env.PAYCHEX_ENV || 'production',
  });

  const result = await checkPaychexConnectivity();
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
