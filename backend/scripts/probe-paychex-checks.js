/**
 * Live probe for Paychex checks endpoints (Postman-aligned Accept: star/star).
 *
 * Usage:
 *   PAYCHEX_DEBUG=1 node scripts/probe-paychex-checks.js
 *   node scripts/probe-paychex-checks.js --worker 004WOHNWMFGQKR2RLNJS --period 1140037241110861
 */
require('dotenv').config();

process.env.PAYCHEX_DEBUG = process.env.PAYCHEX_DEBUG || '1';

const {
  getCompanyChecksByPayPeriod,
  getWorkerChecksByPayPeriod,
} = require('../services/paychexPayPeriodApi');
const { companyId } = require('../config/paychexApi');
const { formatPaychexErrorForLog } = require('../services/paychexErrors');

const SUPPORT_COMPANY_ID = '004WOHNWM70Z2EDFHRDY';
const SUPPORT_WORKER_ID = '004WOHNWMFGQKR2RLNJS';
const SUPPORT_PAY_PERIOD_ID = '1140037241110861';

function arg(name, fallback) {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return fallback;
}

async function main() {
  const cid = arg('company', process.env.PAYCHEX_COMPANY_ID || SUPPORT_COMPANY_ID);
  const workerId = arg('worker', SUPPORT_WORKER_ID);
  const payPeriodId = arg('period', SUPPORT_PAY_PERIOD_ID);

  console.log('Probe config', {
    companyId: cid,
    envCompanyId: companyId() || null,
    workerId,
    payPeriodId,
    PAYCHEX_DEBUG: process.env.PAYCHEX_DEBUG,
  });

  console.log('\n=== Worker checks ===');
  try {
    const workerChecks = await getWorkerChecksByPayPeriod({
      workerId,
      payPeriodId,
      companyId: cid,
    });
    console.log('Worker checks OK', {
      count: workerChecks.length,
      sample: workerChecks[0]
        ? {
            paycheckId: workerChecks[0].paycheckId,
            workerId: workerChecks[0].workerId,
            netPay: workerChecks[0].netPay,
            grossEarnings: workerChecks[0].grossEarnings,
          }
        : null,
    });
  } catch (error) {
    console.error('Worker checks FAILED', formatPaychexErrorForLog(error));
  }

  console.log('\n=== Company checks ===');
  try {
    const companyChecks = await getCompanyChecksByPayPeriod({
      companyId: cid,
      payPeriodId,
    });
    console.log('Company checks OK', {
      count: companyChecks.length,
      matchingWorker: companyChecks.find((c) => String(c.workerId) === String(workerId))
        ? {
            paycheckId: companyChecks.find((c) => String(c.workerId) === String(workerId))
              .paycheckId,
            netPay: companyChecks.find((c) => String(c.workerId) === String(workerId)).netPay,
          }
        : null,
    });
  } catch (error) {
    console.error('Company checks FAILED', formatPaychexErrorForLog(error));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
