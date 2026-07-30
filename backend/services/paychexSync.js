const { query } = require('../db');
const { companyId, getPaychexBaseUrl, PAYCHEX_TIMEOUT_MS } = require('../config/paychexApi');
const { shouldSyncPayComponent } = require('../config/paychex');
const { paychexGet } = require('./paychexHttp');
const { formatSyncErrorForUser } = require('./paychexErrors');

async function logSync(syncType, status, message) {
  await query(
    'INSERT INTO sync_log (sync_type, status, message) VALUES ($1, $2, $3)',
    [syncType, status, message]
  );
}

function parseDate(value) {
  if (!value) return null;
  return value.split('T')[0];
}

function addDays(dateStr, days) {
  const date = new Date(`${dateStr}T12:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().split('T')[0];
}

const STANDARD_PERIOD_LENGTH_DAYS = 13; // inclusive: 14 calendar days (day 0 to day 13)

function isStandardBiweeklyPeriod(startDate, endDate) {
  if (!startDate || !endDate) return false;
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return false;
  const diffDays = Math.round((end.getTime() - start.getTime()) / 86400000);
  return diffDays === STANDARD_PERIOD_LENGTH_DAYS;
}

function formatSyncError(error) {
  return formatSyncErrorForUser(error);
}

async function fetchWorkerHourlyRate(paychexWorkerId) {
  const path = `/workers/${paychexWorkerId}/compensation/payrates`;
  console.log(
    `[sync] Fetching payrates workerId=${paychexWorkerId} ` +
      `baseURL=${getPaychexBaseUrl()} timeoutMs=${PAYCHEX_TIMEOUT_MS}`
  );

  try {
    const rates = await paychexGet(path, { workerId: paychexWorkerId });
    const hourly = rates.find(
      (rate) => rate.rateType === 'HOURLY_RATE' || rate.rateType === 'HOURLY'
    );
    if (!hourly) return null;
    const amount = hourly.amount ?? hourly.rate ?? hourly.value;
    return amount != null ? parseFloat(amount) : null;
  } catch (error) {
    console.warn(
      `[sync] Could not fetch HOURLY_RATE for worker ${paychexWorkerId}:`,
      formatSyncError(error)
    );
    return null;
  }
}

async function syncWorkerPayRates() {
  try {
    const { rows: workers } = await query(
      'SELECT id, paychex_worker_id FROM workers WHERE is_active = true'
    );
    let count = 0;

    for (const worker of workers) {
      const standardRate = await fetchWorkerHourlyRate(worker.paychex_worker_id);
      if (standardRate == null) continue;

      await query('UPDATE workers SET standard_rate = $1 WHERE id = $2', [
        standardRate,
        worker.id,
      ]);
      count += 1;
    }

    await logSync('worker_pay_rates', 'SUCCESS', `Synced ${count} worker hourly rates`);
    return {
      syncType: 'worker_pay_rates',
      status: 'SUCCESS',
      message: `Synced ${count} worker hourly rates`,
    };
  } catch (error) {
    const detail = formatSyncError(error);
    const message = detail.message || 'Unknown error';
    console.error('Paychex sync error:', detail);
    await logSync('worker_pay_rates', 'FAILED', message);
    return { syncType: 'worker_pay_rates', status: 'FAILED', message };
  }
}

async function syncWorkers() {
  try {
    const workers = await paychexGet(`/companies/${companyId()}/workers`);
    let count = 0;

    for (const worker of workers) {
      const paychexWorkerId = worker.workerId;
      const firstName = worker.name?.givenName || '';
      const lastName = worker.name?.familyName || '';
      const employeeCode = worker.employeeId || null;
      const isActive = worker.currentStatus?.statusType === 'ACTIVE';

      if (worker.workerType && worker.workerType !== 'EMPLOYEE') {
        console.log(`[sync] Skipping non-employee: ${firstName} ${lastName} (${worker.workerType})`);
        continue;
      }

      if (worker.exemptionType === 'EXEMPT') {
        console.log(`[sync] Skipping exempt/salaried worker: ${firstName} ${lastName}`);
        continue;
      }

      const workerType = worker.workerType || 'EMPLOYEE';
      const exemptionType = worker.exemptionType || 'NON_EXEMPT';

      await query(
        `INSERT INTO workers (
           paychex_worker_id, first_name, last_name, employee_code,
           worker_type, exemption_type, is_active, last_synced_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, now())
         ON CONFLICT (paychex_worker_id) DO UPDATE SET
           first_name = EXCLUDED.first_name,
           last_name = EXCLUDED.last_name,
           employee_code = EXCLUDED.employee_code,
           worker_type = EXCLUDED.worker_type,
           exemption_type = EXCLUDED.exemption_type,
           is_active = EXCLUDED.is_active,
           last_synced_at = now()`,
        [paychexWorkerId, firstName, lastName, employeeCode, workerType, exemptionType, isActive]
      );
      count += 1;
    }

    await logSync('workers', 'SUCCESS', `Synced ${count} workers`);
    return { syncType: 'workers', status: 'SUCCESS', message: `Synced ${count} workers` };
  } catch (error) {
    const detail = formatSyncError(error);
    const message = detail.message || 'Unknown error';
    console.error('Paychex sync error:', detail);
    await logSync('workers', 'FAILED', message);
    return { syncType: 'workers', status: 'FAILED', message };
  }
}

async function syncPayComponents() {
  try {
    const { rows: workers } = await query(
      'SELECT id, paychex_worker_id FROM workers WHERE is_active = true'
    );
    let count = 0;

    for (const worker of workers) {
      const components = await paychexGet(
        `/workers/${worker.paychex_worker_id}/paycomponents`,
        { workerId: worker.paychex_worker_id }
      );

      for (const component of components) {
        if (!shouldSyncPayComponent(component)) {
          continue;
        }

        const componentId = component.componentId;
        const name = component.name || '';
        const rate = component.value != null ? parseFloat(component.value) : null;

        await query(
          `INSERT INTO worker_pay_components (worker_id, paychex_component_id, name, rate, last_synced_at)
           VALUES ($1, $2, $3, $4, now())
           ON CONFLICT (worker_id, paychex_component_id) DO UPDATE SET
             name = EXCLUDED.name,
             rate = EXCLUDED.rate,
             last_synced_at = now()`,
          [worker.id, componentId, name, rate]
        );
        count += 1;
      }
    }

    await logSync('pay_components', 'SUCCESS', `Synced ${count} pay components`);
    return {
      syncType: 'pay_components',
      status: 'SUCCESS',
      message: `Synced ${count} pay components`,
    };
  } catch (error) {
    const detail = formatSyncError(error);
    const message = detail.message || 'Unknown error';
    console.error('Paychex sync error:', detail);
    await logSync('pay_components', 'FAILED', message);
    return { syncType: 'pay_components', status: 'FAILED', message };
  }
}

async function syncJobSites() {
  await logSync('job_sites', 'SUCCESS', 'Job site sync disabled (managed locally)');
  return {
    syncType: 'job_sites',
    status: 'SUCCESS',
    message: 'Job site sync disabled (managed locally)',
  };
}

/**
 * PURPOSE: Operational / current pay-period sync (status=OPEN only).
 *
 * Writes into local `pay_periods` for Daily Entry, Payroll, Submit, Summary.
 * These are the active Flex windows workers enter hours against — not a
 * historical archive for paycheck retrieval.
 *
 * Contrast: syncHistoricalPaychexPayPeriods() uses status=COMPLETED (+ date
 * range) and writes `paychex_pay_periods` for /checks validation.
 */
async function syncPayPeriods() {
  try {
    // OPEN only — current/entry windows for local payroll workflows.
    // Do not add COMPLETED here; that belongs to syncHistoricalPaychexPayPeriods.
    const periods = await paychexGet(
      `/companies/${companyId()}/payperiods?status=OPEN`
    );

    const standardPeriods = periods.filter((period) =>
      isStandardBiweeklyPeriod(parseDate(period.startDate), parseDate(period.endDate))
    );

    const droppedPeriods = periods.filter(
      (period) =>
        !isStandardBiweeklyPeriod(parseDate(period.startDate), parseDate(period.endDate))
    );

    console.log('[sync] Filtered OPEN pay periods to standard biweekly only', {
      totalFetched: periods.length,
      standardCount: standardPeriods.length,
      droppedCount: droppedPeriods.length,
    });
    if (droppedPeriods.length > 0) {
      console.log(
        '[sync] Dropped non-biweekly OPEN periods:',
        droppedPeriods.map((period) => ({
          payPeriodId: period.payPeriodId,
          startDate: parseDate(period.startDate),
          endDate: parseDate(period.endDate),
          status: period.status,
        }))
      );
    }

    let count = 0;

    for (const period of standardPeriods) {
      const paychexPeriodId = period.payPeriodId;
      const startDate = parseDate(period.startDate);
      const endDate = parseDate(period.endDate);
      const payDate = parseDate(period.checkDate);
      const rawStatus = period.status || 'INITIAL';
      const status = (rawStatus === 'INITIAL' || rawStatus === 'CURRENT') ? 'OPEN' : rawStatus;

      const week1Start = startDate;
      const week1End = addDays(startDate, 6);
      const week2Start = addDays(startDate, 7);
      const week2End = endDate;
      const submitByDate = parseDate(period.submitByDate);

      await query(
        `INSERT INTO pay_periods (
           paychex_period_id, start_date, end_date, submit_by_date, pay_date, status,
           week1_start, week1_end, week2_start, week2_end
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (paychex_period_id) DO UPDATE SET
           start_date = EXCLUDED.start_date,
           end_date = EXCLUDED.end_date,
           submit_by_date = EXCLUDED.submit_by_date,
           pay_date = EXCLUDED.pay_date,
           status = EXCLUDED.status,
           week1_start = EXCLUDED.week1_start,
           week1_end = EXCLUDED.week1_end,
           week2_start = EXCLUDED.week2_start,
           week2_end = EXCLUDED.week2_end`,
        [
          paychexPeriodId,
          startDate,
          endDate,
          submitByDate,
          payDate,
          status,
          week1Start,
          week1End,
          week2Start,
          week2End,
        ]
      );
      count += 1;
    }

    await logSync('pay_periods', 'SUCCESS', `Synced ${count} pay periods`);
    return {
      syncType: 'pay_periods',
      status: 'SUCCESS',
      message: `Synced ${count} pay periods`,
    };
  } catch (error) {
    const detail = formatSyncError(error);
    const message = detail.message || 'Unknown error';
    console.error('Paychex sync error:', detail);
    await logSync('pay_periods', 'FAILED', message);
    return { syncType: 'pay_periods', status: 'FAILED', message };
  }
}

/**
 * PURPOSE: Historical pay-period discovery (status=COMPLETED, last ~12 months).
 *
 * Writes into `paychex_pay_periods` — the only local source of truth for which
 * Paychex payPeriodIds may be used on GET .../checks?payperiodid=.
 *
 * Contrast: syncPayPeriods() uses status=OPEN and writes operational `pay_periods`.
 * Both run in runFullSync() because they feed different product surfaces.
 */
async function syncHistoricalPaychexPayPeriods() {
  try {
    const { syncCompanyPayPeriods } = require('./paychexPayPeriodStore');
    const cid = companyId();
    if (!cid) {
      return {
        syncType: 'paychex_pay_periods',
        status: 'FAILED',
        message: 'PAYCHEX_COMPANY_ID is not configured',
      };
    }

    // Defaults: COMPLETED + buildPaychexDateRange() full-day UTC bounds (no ms).
    const summary = await syncCompanyPayPeriods({ companyId: cid });
    const message =
      `Fetched ${summary.fetchedCount} (inserted ${summary.insertedCount}, ` +
      `updated ${summary.updatedCount})`;
    await logSync('paychex_pay_periods', 'SUCCESS', message);
    return { syncType: 'paychex_pay_periods', status: 'SUCCESS', message, summary };
  } catch (error) {
    const detail = formatSyncError(error);
    const message = detail.message || 'Unknown error';
    console.error('Paychex historical pay period sync error:', detail);
    await logSync('paychex_pay_periods', 'FAILED', message);
    return { syncType: 'paychex_pay_periods', status: 'FAILED', message };
  }
}

/**
 * Operational + historical pay-period discovery.
 * OPEN → pay_periods; COMPLETED → paychex_pay_periods.
 */
async function runPayPeriodSync() {
  const results = [];
  results.push(await syncPayPeriods());
  results.push(await syncHistoricalPaychexPayPeriods());
  return results;
}

/**
 * Workers, rates, pay components, and recurring reimbursements.
 * Each sync catches its own errors so one failure does not block the rest.
 */
async function runReferenceDataSync() {
  const results = [];
  results.push(await syncWorkers());
  results.push(await syncWorkerPayRates());
  results.push(await syncPayComponents());
  const { syncRecurringReimbursementsForAllWorkers } = require('./paychexRecurringSync');
  results.push(await syncRecurringReimbursementsForAllWorkers());
  return results;
}

async function runFullSync() {
  const payPeriodResults = await runPayPeriodSync();
  const referenceResults = await runReferenceDataSync();
  return [...payPeriodResults, ...referenceResults];
}

module.exports = {
  runFullSync,
  runPayPeriodSync,
  runReferenceDataSync,
  syncWorkers,
  syncWorkerPayRates,
  syncPayComponents,
  syncJobSites,
  syncPayPeriods,
  syncHistoricalPaychexPayPeriods,
  fetchWorkerHourlyRate,
  formatSyncError,
  isStandardBiweeklyPeriod,
};
