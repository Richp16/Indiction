const { query } = require('../db');
const { companyId, getPaychexBaseUrl, PAYCHEX_TIMEOUT_MS } = require('../config/paychexApi');
const { shouldSyncPayComponent } = require('../config/paychex');
const { paychexGet } = require('./paychexHttp');
const { formatPaychexErrorForLog } = require('./paychexErrors');

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

function formatSyncError(error) {
  if (error.paychexErrorType) {
    return formatPaychexErrorForLog(error);
  }
  const status = error.response?.status;
  const data = error.response?.data;
  if (status) {
    return { type: 'http', statusCode: status, message: JSON.stringify(data) };
  }
  return { type: 'unknown', message: error.message || 'Unknown error' };
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

async function syncPayPeriods() {
  try {
    const periods = await paychexGet(
      `/companies/${companyId()}/payperiods?status=OPEN`
    );
    let count = 0;

    for (const period of periods) {
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

async function runFullSync() {
  const results = [];
  results.push(await syncWorkers());
  results.push(await syncWorkerPayRates());
  results.push(await syncPayComponents());
  results.push(await syncPayPeriods());
  return results;
}

module.exports = {
  runFullSync,
  syncWorkers,
  syncWorkerPayRates,
  syncPayComponents,
  syncJobSites,
  syncPayPeriods,
  fetchWorkerHourlyRate,
};
