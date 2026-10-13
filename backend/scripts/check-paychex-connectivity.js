require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { getPaychexBaseUrl } = require('../config/paychexApi');
const { checkPaychexConnectivity } = require('../services/paychexHttp');
const { missingPaychexCredentials, safePaychexFailure } = require('../middleware/paychexGuard');

function redactCompanyId(value) {
  const text = String(value || '');
  if (text.length <= 4) return text ? '****' : '(missing)';
  return `${'*'.repeat(Math.max(4, text.length - 4))}${text.slice(-4)}`;
}

async function main() {
  const missing = missingPaychexCredentials();
  const env = (process.env.PAYCHEX_ENV || 'production').toLowerCase();
  const baseUrl = getPaychexBaseUrl();

  console.log('Paychex health');
  console.log(`  environment: ${env}`);
  console.log(`  base URL: ${baseUrl}`);
  console.log(`  company id: ${redactCompanyId(process.env.PAYCHEX_COMPANY_ID)}`);
  console.log(`  client id: ${process.env.PAYCHEX_CLIENT_ID ? 'set' : 'missing'}`);
  console.log(`  client secret: ${process.env.PAYCHEX_CLIENT_SECRET ? 'set' : 'missing'}`);

  if (missing.length > 0) {
    console.error(`Missing environment variables: ${missing.join(', ')}`);
    process.exit(1);
  }

  if (env === 'sandbox' && baseUrl === 'https://api.paychex.com') {
    console.error('PAYCHEX_ENV=sandbox but the base URL is production. Remove PAYCHEX_BASE_URL or point it at the sandbox host.');
    process.exit(1);
  }
  if (env === 'production' && baseUrl.includes('sandbox')) {
    console.error('PAYCHEX_ENV=production but the base URL is a sandbox host. Remove PAYCHEX_BASE_URL or set PAYCHEX_ENV=sandbox.');
    process.exit(1);
  }

  const result = await checkPaychexConnectivity();
  if (!result.ok) {
    console.error(safePaychexFailure(result));
    if (result.error?.statusCode) console.error(`  HTTP status: ${result.error.statusCode}`);
    if (result.error?.networkCode) console.error(`  network code: ${result.error.networkCode}`);
    process.exit(1);
  }

  console.log('Paychex health OK');
  console.log('  token: obtained');
  console.log(`  company read: HTTP ${result.status}`);
  process.exit(0);
}

main().catch((error) => {
  const status = error.statusCode || error.response?.status;
  const network = error.networkCode || error.code;
  console.error(safePaychexFailure({ error: { statusCode: status, networkCode: network } }));
  if (status) console.error(`  HTTP status: ${status}`);
  if (network && !status) console.error(`  network code: ${network}`);
  process.exit(1);
});
