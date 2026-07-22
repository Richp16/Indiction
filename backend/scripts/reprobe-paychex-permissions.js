/**
 * Re-investigation probe after Paychex Flex Read/Write permission change.
 * Exact apples-to-apples comparison vs prior run.
 */
require('dotenv').config();

const { companyId, getPaychexBaseUrl } = require('../config/paychexApi');
const { getToken } = require('../services/paychexAuth');
const { paychexHttp } = require('../services/paychexHttp');

async function rawGet(path) {
  const token = await getToken();
  try {
    const response = await paychexHttp.request({
      method: 'get',
      url: path,
      headers: { Authorization: `Bearer ${token}` },
      validateStatus: () => true,
    });
    return {
      status: response.status,
      content: response.data?.content || [],
      errors: response.data?.errors || [],
      body: response.data,
    };
  } catch (error) {
    return {
      status: error.response?.status || 0,
      content: [],
      errors: error.response?.data?.errors || [],
      body: error.response?.data || { message: error.message },
    };
  }
}

function errorSummary(result) {
  if (!result.errors?.length) return '';
  return result.errors.map((e) => `${e.code || ''} ${e.description || ''}`.trim()).join('; ');
}

async function main() {
  const cid = companyId();
  const workerId = '004WOHNWMFGQKR2RLNJS';
  // Support-confirmed valid period for company 004WOHNWM70Z2EDFHRDY.
  // Do NOT use 1140037269275368 — that ID does not exist on this account.
  const periodId = '1140037241110861';

  console.log('[reprobe] baseURL=', getPaychexBaseUrl());
  console.log('[reprobe] companyId=', cid ? '(set)' : '(missing)');
  console.log('[reprobe] workerId=', workerId);
  console.log('[reprobe] periodId=', periodId);

  // STEP 1 — Checks
  console.log('\n========== STEP 1: CHECKS ==========');
  for (const path of [
    `/workers/${workerId}/checks?payperiodid=${periodId}`,
    `/companies/${cid}/checks?payperiodid=${periodId}`,
  ]) {
    const result = await rawGet(path);
    console.log('\nGET', path);
    console.log('  status=', result.status);
    console.log('  count=', result.content.length);
    console.log('  errors=', errorSummary(result) || '(none)');
    console.log('  body=', JSON.stringify(result.body, null, 2).slice(0, 2500));
  }

  // STEP 2 — Pay periods
  console.log('\n========== STEP 2: PAYPERIODS ==========');
  const periodsPath = `/companies/${cid}/payperiods?limit=25&offset=0`;
  const periods = await rawGet(periodsPath);
  const summary = (periods.content || []).map((p) => ({
    payPeriodId: p.payPeriodId,
    startDate: p.startDate,
    endDate: p.endDate,
    status: p.status,
    checkCount: p.checkCount,
    description: p.description,
  }));
  const statuses = [...new Set(summary.map((p) => p.status).filter(Boolean))];
  const dateRange = summary.reduce(
    (acc, p) => {
      if (!acc.min || p.startDate < acc.min) acc.min = p.startDate;
      if (!acc.max || p.endDate > acc.max) acc.max = p.endDate;
      return acc;
    },
    { min: null, max: null }
  );
  console.log('GET', periodsPath);
  console.log('  status=', periods.status);
  console.log('  count=', summary.length);
  console.log('  statuses=', statuses);
  console.log('  dateRange=', dateRange);
  console.log('  periods=', JSON.stringify(summary, null, 2));

  // STEP 3 — Previously 403 candidates
  console.log('\n========== STEP 3: PREVIOUSLY 403 ENDPOINTS ==========');
  for (const path of [
    `/workers/${workerId}/payperiods`,
    `/companies/${cid}/payrolls`,
    `/companies/${cid}/reports`,
    `/companies/${cid}/processingperiods`,
  ]) {
    const result = await rawGet(path);
    console.log('\nGET', path);
    console.log('  status=', result.status);
    console.log('  count=', result.content.length);
    console.log('  errors=', errorSummary(result) || '(none)');
    if (result.content.length) {
      console.log('  sample keys=', Object.keys(result.content[0]));
      console.log('  sample=', JSON.stringify(result.content[0], null, 2).slice(0, 1200));
    } else {
      console.log('  body=', JSON.stringify(result.body).slice(0, 600));
    }
  }

  console.log('\n[reprobe] done');
  process.exit(0);
}

main().catch((err) => {
  console.error('[reprobe] fatal', err);
  process.exit(1);
});
