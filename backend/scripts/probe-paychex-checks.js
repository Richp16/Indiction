/**
 * Live probe for Paychex checks endpoints (Postman-aligned Accept: star/star).
 *
 * Usage:
 *   node scripts/probe-paychex-checks.js --company COMPANY_ID --worker WORKER_ID --period PAY_PERIOD_ID
 */
require('dotenv').config();

const {
  getCompanyChecksByPayPeriod,
  getWorkerChecksByPayPeriod,
} = require('../services/paychexPayPeriodApi');
const { companyId } = require('../config/paychexApi');
const { formatPaychexErrorForLog } = require('../services/paychexErrors');

function arg(name, fallback) {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return fallback;
}

async function main() {
  const cid = arg('company', process.env.PAYCHEX_COMPANY_ID || '');
  const workerId = arg('worker', '');
  const payPeriodId = arg('period', '');
  if (!cid || !workerId || !payPeriodId) {
    console.error('Pass --company, --worker, and --period. No sample Paychex ids are built in.');
    process.exit(1);
  }

  console.log('Probe config', {
    companyId: cid,
    envCompanyId: companyId() || null,
    workerId,
    payPeriodId,
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
