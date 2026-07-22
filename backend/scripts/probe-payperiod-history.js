/**
 * One-off probe: find historical payPeriodIds and test worker checks.
 * Run: node scripts/probe-payperiod-history.js
 * Does not modify production code paths.
 */
require('dotenv').config();

const { companyId, getPaychexBaseUrl } = require('../config/paychexApi');
const { getToken } = require('../services/paychexAuth');
const { paychexHttp } = require('../services/paychexHttp');
const { query } = require('../db');

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
      metadata: response.data?.metadata || null,
      body: response.data,
      error: null,
    };
  } catch (error) {
    return {
      status: error.response?.status || 0,
      content: [],
      metadata: null,
      body: error.response?.data || null,
      error: error.message,
    };
  }
}

function summarizePeriods(content) {
  return (content || []).map((p) => ({
    payPeriodId: p.payPeriodId || p.processingPeriodId || p.id,
    startDate: p.startDate || p.periodStartDate,
    endDate: p.endDate || p.periodEndDate,
    status: p.status,
    checkCount: p.checkCount,
    description: p.description,
  }));
}

async function main() {
  const cid = companyId();
  console.log('[probe] baseURL=', getPaychexBaseUrl());
  console.log('[probe] companyId=', cid ? '(set)' : '(missing)');

  // --- Company payperiods (baseline) ---
  const variants = [
    `/companies/${cid}/payperiods?limit=50&offset=0`,
    `/companies/${cid}/payperiods?from=2025-01-01&to=2026-07-21&limit=50&offset=0`,
    `/companies/${cid}/payperiods?status=COMPLETED&limit=50&offset=0`,
    `/companies/${cid}/payperiods?status=PROCESSED&limit=50&offset=0`,
    `/companies/${cid}/payperiods?status=CLOSED&limit=50&offset=0`,
    `/companies/${cid}/payperiods?status=INITIAL&limit=50&offset=0`,
    `/companies/${cid}/payperiods?status=OPEN&limit=50&offset=0`,
  ];

  let periods = [];
  for (const path of variants) {
    const result = await rawGet(path);
    const summary = summarizePeriods(result.content);
    console.log('\n[probe] GET', path);
    console.log('  status=', result.status, 'count=', summary.length);
    if (summary.length) {
      console.log('  sample=', JSON.stringify(summary.slice(0, 3), null, 2));
      console.log(
        '  statuses=',
        [...new Set(summary.map((p) => p.status).filter(Boolean))]
      );
      console.log(
        '  dateRange=',
        summary.reduce(
          (acc, p) => {
            if (!acc.min || p.startDate < acc.min) acc.min = p.startDate;
            if (!acc.max || p.endDate > acc.max) acc.max = p.endDate;
            return acc;
          },
          { min: null, max: null }
        )
      );
      if (periods.length === 0) periods = summary;
    } else if (result.body) {
      console.log('  body=', JSON.stringify(result.body).slice(0, 500));
    }
  }

  // Prefer support-confirmed period 1140037241110861, or June/July 2026 window.
  // Do NOT prefer 1140037269275368 — invalid for this company (Paychex support).
  const target =
    periods.find(
      (p) =>
        String(p.payPeriodId) === '1140037241110861' ||
        (p.startDate &&
          p.startDate.startsWith('2026-06') &&
          p.endDate &&
          p.endDate.startsWith('2026-07'))
    ) || periods[0];

  console.log('\n[probe] Selected period for Step 1:', target || null);

  // Pick a worker from local DB with paychex_worker_id and recent entries
  let workerId = null;
  try {
    const workerResult = await query(
      `SELECT w.paychex_worker_id, w.first_name, w.last_name
       FROM workers w
       WHERE w.paychex_worker_id IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM daily_time_entries d
           WHERE d.worker_id = w.id
             AND d.date_worked BETWEEN '2026-06-24' AND '2026-07-23'
         )
       ORDER BY w.last_name
       LIMIT 1`
    );
    workerId = workerResult.rows[0]?.paychex_worker_id || null;
    console.log('[probe] Local worker with entries in range:', workerResult.rows[0] || null);
  } catch (err) {
    console.warn('[probe] DB worker lookup failed:', err.message);
  }

  if (!workerId) {
    const workers = await rawGet(`/companies/${cid}/workers?limit=5&offset=0`);
    workerId = workers.content?.[0]?.workerId || null;
    console.log('[probe] Fallback Paychex worker:', {
      status: workers.status,
      workerId,
      name: workers.content?.[0]?.name,
    });
  }

  // --- Step 1: worker checks with INITIAL payPeriodId ---
  if (target?.payPeriodId && workerId) {
    const checkPath =
      `/workers/${workerId}/checks?payperiodid=${encodeURIComponent(target.payPeriodId)}`;
    const checks = await rawGet(checkPath);
    console.log('\n[probe] STEP 1 Worker Checks');
    console.log('  GET', checkPath);
    console.log('  status=', checks.status);
    console.log('  count=', checks.content?.length || 0);
    console.log(
      '  body sample=',
      JSON.stringify(checks.content?.[0] || checks.body, null, 2)?.slice(0, 2000)
    );

    const companyCheckPath =
      `/companies/${cid}/checks?payperiodid=${encodeURIComponent(target.payPeriodId)}`;
    const companyChecks = await rawGet(companyCheckPath);
    console.log('\n[probe] STEP 1 Company Checks (payperiodid only)');
    console.log('  GET', companyCheckPath);
    console.log('  status=', companyChecks.status);
    console.log('  count=', companyChecks.content?.length || 0);
    console.log(
      '  body sample=',
      JSON.stringify(companyChecks.content?.[0] || companyChecks.body, null, 2)?.slice(0, 1500)
    );
  }

  // --- Step 2 candidates ---
  if (workerId) {
    const workerPeriods = await rawGet(`/workers/${workerId}/payperiods?limit=50&offset=0`);
    console.log('\n[probe] STEP 2a GET /workers/{id}/payperiods');
    console.log('  status=', workerPeriods.status, 'count=', workerPeriods.content?.length || 0);
    console.log(
      '  sample=',
      JSON.stringify(summarizePeriods(workerPeriods.content).slice(0, 5), null, 2)
    );
    if (!workerPeriods.content?.length && workerPeriods.body) {
      console.log('  body=', JSON.stringify(workerPeriods.body).slice(0, 500));
    }
  }

  for (const path of [
    `/companies/${cid}/payrolls?limit=50&offset=0`,
    `/companies/${cid}/payrolls?from=2025-01-01&to=2026-07-21`,
    `/companies/${cid}/reports`,
    `/reports`,
    `/companies/${cid}/processingperiods?limit=50&offset=0`,
    `/companies/${cid}/processingperiods?from=2025-01-01&to=2026-07-21`,
  ]) {
    const result = await rawGet(path);
    console.log(`\n[probe] STEP 2 GET ${path}`);
    console.log('  status=', result.status, 'count=', result.content?.length || 0);
    if (result.content?.length) {
      console.log('  sample keys=', Object.keys(result.content[0]));
      console.log('  sample=', JSON.stringify(result.content[0], null, 2).slice(0, 800));
    } else if (result.body) {
      console.log('  body=', JSON.stringify(result.body).slice(0, 500));
    }
  }

  // Pagination depth on payperiods
  console.log('\n[probe] STEP 2d pagination depth on /payperiods');
  for (const offset of [0, 25, 50, 100]) {
    const path = `/companies/${cid}/payperiods?limit=25&offset=${offset}`;
    const result = await rawGet(path);
    const summary = summarizePeriods(result.content);
    console.log(
      `  offset=${offset} status=${result.status} count=${summary.length}`,
      summary[0]
        ? `first=${summary[0].startDate}..${summary[0].endDate} status=${summary[0].status}`
        : ''
    );
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('[probe] fatal', err);
  process.exit(1);
});
