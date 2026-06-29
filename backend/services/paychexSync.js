const axios = require('axios');
const { query } = require('../db');
const { getToken } = require('./paychexAuth');

const baseUrl = () => process.env.PAYCHEX_BASE_URL;
const companyId = () => process.env.PAYCHEX_COMPANY_ID;

async function paychexGet(path) {
  const token = await getToken();
  const items = [];
  let url = `${baseUrl()}${path}`;
  let offset = 0;
  const limit = 100;

  while (url) {
    const response = await axios.get(url, {
      headers: { Authorization: `Bearer ${token}` },
      params: url.includes('?') ? undefined : { offset, limit },
    });

    const content = response.data.content || [];
    items.push(...content);

    const pagination = response.data.metadata?.pagination;
    if (pagination && pagination.itemCount > offset + limit) {
      offset += limit;
      url = `${baseUrl()}${path}${path.includes('?') ? '&' : '?'}offset=${offset}&limit=${limit}`;
    } else {
      url = null;
    }
  }

  return items;
}

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

function getNthWeekdayOfMonth(year, month, weekday, n) {
  const date = new Date(year, month, 1);
  let count = 0;
  while (date.getMonth() === month) {
    if (date.getDay() === weekday) {
      count += 1;
      if (count === n) {
        return new Date(date);
      }
    }
    date.setDate(date.getDate() + 1);
  }
  return null;
}

function getLastWeekdayOfMonth(year, month, weekday) {
  const date = new Date(year, month + 1, 0);
  while (date.getDay() !== weekday) {
    date.setDate(date.getDate() - 1);
  }
  return date;
}

function getFederalHolidays(year) {
  const holidays = [
    new Date(year, 0, 1),
    getLastWeekdayOfMonth(year, 4, 1),
    new Date(year, 6, 4),
    getNthWeekdayOfMonth(year, 8, 1, 1),
    getNthWeekdayOfMonth(year, 10, 4, 4),
    new Date(year, 11, 25),
  ];
  return holidays.map((d) => d.toISOString().split('T')[0]);
}

function isBusinessDay(dateStr, holidaySet) {
  const date = new Date(`${dateStr}T12:00:00`);
  const day = date.getDay();
  if (day === 0 || day === 6) return false;
  return !holidaySet.has(dateStr);
}

function subtractBusinessDays(dateStr, businessDays) {
  const year = new Date(`${dateStr}T12:00:00`).getFullYear();
  const holidays = new Set([
    ...getFederalHolidays(year),
    ...getFederalHolidays(year - 1),
    ...getFederalHolidays(year + 1),
  ]);

  const date = new Date(`${dateStr}T12:00:00`);
  let remaining = businessDays;

  while (remaining > 0) {
    date.setDate(date.getDate() - 1);
    const current = date.toISOString().split('T')[0];
    if (isBusinessDay(current, holidays)) {
      remaining -= 1;
    }
  }

  return date.toISOString().split('T')[0];
}

function addDays(dateStr, days) {
  const date = new Date(`${dateStr}T12:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().split('T')[0];
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

      await query(
        `INSERT INTO workers (paychex_worker_id, first_name, last_name, employee_code, is_active, last_synced_at)
         VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (paychex_worker_id) DO UPDATE SET
           first_name = EXCLUDED.first_name,
           last_name = EXCLUDED.last_name,
           employee_code = EXCLUDED.employee_code,
           is_active = EXCLUDED.is_active,
           last_synced_at = now()`,
        [paychexWorkerId, firstName, lastName, employeeCode, isActive]
      );
      count += 1;
    }

    await logSync('workers', 'SUCCESS', `Synced ${count} workers`);
    return { syncType: 'workers', status: 'SUCCESS', message: `Synced ${count} workers` };
  } catch (error) {
    const message = error.message || 'Unknown error';
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
        `/workers/${worker.paychex_worker_id}/paycomponents`
      );

      for (const component of components) {
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
    const message = error.message || 'Unknown error';
    await logSync('pay_components', 'FAILED', message);
    return { syncType: 'pay_components', status: 'FAILED', message };
  }
}

async function syncJobSites() {
  try {
    const jobs = await paychexGet(`/companies/${companyId()}/jobs`);
    let count = 0;

    for (const job of jobs) {
      const paychexJobId = job.jobId;
      const name = job.jobName || job.name || '';
      const isActive = job.endDate ? false : true;

      await query(
        `INSERT INTO job_sites (paychex_job_id, name, is_active, last_synced_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (paychex_job_id) DO UPDATE SET
           name = EXCLUDED.name,
           is_active = EXCLUDED.is_active,
           last_synced_at = now()`,
        [paychexJobId, name, isActive]
      );
      count += 1;
    }

    await logSync('job_sites', 'SUCCESS', `Synced ${count} job sites`);
    return { syncType: 'job_sites', status: 'SUCCESS', message: `Synced ${count} job sites` };
  } catch (error) {
    const message = error.message || 'Unknown error';
    await logSync('job_sites', 'FAILED', message);
    return { syncType: 'job_sites', status: 'FAILED', message };
  }
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
      const status = period.status || 'OPEN';

      const week1Start = startDate;
      const week1End = addDays(startDate, 6);
      const week2Start = addDays(startDate, 7);
      const week2End = endDate;
      const submitByDate = subtractBusinessDays(payDate, 3);

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
    const message = error.message || 'Unknown error';
    await logSync('pay_periods', 'FAILED', message);
    return { syncType: 'pay_periods', status: 'FAILED', message };
  }
}

async function runFullSync() {
  const results = [];
  results.push(await syncWorkers());
  results.push(await syncPayComponents());
  results.push(await syncJobSites());
  results.push(await syncPayPeriods());
  return results;
}

module.exports = {
  runFullSync,
  syncWorkers,
  syncPayComponents,
  syncJobSites,
  syncPayPeriods,
};
