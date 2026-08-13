/**
 * Integration tests for daily entry dual-write flow.
 * Requires DATABASE_URL and migrations 007/008 applied.
 *
 * Run: npm test
 */
require('dotenv').config();
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { query, pool } = require('../db');
const {
  createDailyEntry,
  createBulkDailyEntries,
  updateDailyEntry,
} = require('../services/dailyEntryService');
const { loadHoursRows } = require('../services/certifiedPayrollService');
const { mapPayCodeToPaychexComponent } = require('../config/payCodeMapping');

function toDateStr(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).split('T')[0];
}

describe('daily entry dual-write', () => {
  let workerId;
  let secondWorkerId;
  let jobSiteId;
  let payPeriodId;
  let payPeriodEndDate;
  let week1Start;
  let week1End;
  const createdDailyIds = [];
  const touchedWorkerIds = [];

  before(async () => {
    const workerResult = await query(
      `SELECT id FROM workers WHERE is_active = true AND standard_rate IS NOT NULL LIMIT 2`
    );
    assert.ok(workerResult.rows.length > 0, 'Need at least one active worker with a rate');
    workerId = workerResult.rows[0].id;
    secondWorkerId = workerResult.rows[1]?.id || null;
    touchedWorkerIds.push(workerId);
    if (secondWorkerId) touchedWorkerIds.push(secondWorkerId);

    const siteResult = await query(
      `SELECT id FROM job_sites WHERE is_active = true LIMIT 1`
    );
    assert.ok(siteResult.rows.length > 0, 'Need at least one active job site');
    jobSiteId = siteResult.rows[0].id;

    const periodResult = await query(
      `SELECT id, end_date::text AS end_date, week1_start::text, week1_end::text
       FROM pay_periods
       WHERE status = 'OPEN'
       ORDER BY start_date DESC
       LIMIT 1`
    );
    assert.ok(periodResult.rows.length > 0, 'Need an open pay period');
    payPeriodId = periodResult.rows[0].id;
    payPeriodEndDate = periodResult.rows[0].end_date;
    week1Start = periodResult.rows[0].week1_start;
    week1End = periodResult.rows[0].week1_end;
  });

  after(async () => {
    if (createdDailyIds.length > 0) {
      await query('DELETE FROM daily_time_entries WHERE id = ANY($1::uuid[])', [
        createdDailyIds,
      ]);
      await query(
        `DELETE FROM time_entries
         WHERE worker_id = ANY($1::uuid[]) AND job_site_id = $2 AND pay_period_id = $3`,
        [touchedWorkerIds, jobSiteId, payPeriodId]
      );
    }
    await pool.end();
  });

  it('writes daily_time_entries and aggregated time_entries for REGULAR hours', async () => {
    const result = await createDailyEntry({
      workerId,
      jobSiteId,
      payPeriodId,
      payCode: 'REGULAR',
      dateWorked: week1Start,
      hours: 8,
      enteredBy: null,
    });

    createdDailyIds.push(result.daily.id);

    assert.equal(Number(result.daily.hours_worked), 8);
    assert.equal(Number(result.daily.regular_hours), 8);
    assert.equal(Number(result.daily.overtime_hours), 0);
    assert.equal(toDateStr(result.daily.pay_period_end_date), payPeriodEndDate);

    assert.equal(result.aggregate.paychex_component_id, 'HOURLY');
    assert.equal(Number(result.aggregate.hours), 8);
  });

  it('aggregates multiple OT entries into one time_entries row', async () => {
    const secondDay = new Date(`${week1Start}T12:00:00Z`);
    secondDay.setUTCDate(secondDay.getUTCDate() + 1);
    const otDate1 = week1Start;
    const otDate2 = secondDay.toISOString().slice(0, 10);

    const first = await createDailyEntry({
      workerId,
      jobSiteId,
      payPeriodId,
      payCode: 'OT',
      dateWorked: otDate1,
      hours: 2,
      enteredBy: null,
    });
    createdDailyIds.push(first.daily.id);

    const second = await createDailyEntry({
      workerId,
      jobSiteId,
      payPeriodId,
      payCode: 'OT',
      dateWorked: otDate2,
      hours: 3,
      enteredBy: null,
    });
    createdDailyIds.push(second.daily.id);

    const agg = await query(
      `SELECT hours FROM time_entries
       WHERE worker_id = $1 AND job_site_id = $2 AND pay_period_id = $3
         AND paychex_component_id = 'OVERTIME'`,
      [workerId, jobSiteId, payPeriodId]
    );

    assert.equal(agg.rows.length, 1);
    assert.equal(Number(agg.rows[0].hours), 5);
  });

  it('returns certified payroll hour rows from daily_time_entries', async () => {
    const rows = await loadHoursRows(jobSiteId, week1End);
    const workerRows = rows.filter((row) => row.id === workerId);
    assert.ok(workerRows.length > 0, 'Expected certified payroll rows for test worker');
  });

  it('admin edit updates daily hours and recomputes the time_entries aggregate', async () => {
    const editDate = addDays(week1Start, 3);
    const created = await createDailyEntry({
      workerId,
      jobSiteId,
      payPeriodId,
      payCode: 'REGULAR',
      dateWorked: editDate,
      hours: 8,
      enteredBy: null,
    });
    createdDailyIds.push(created.daily.id);

    const beforeAgg = await query(
      `SELECT hours FROM time_entries
       WHERE worker_id = $1 AND job_site_id = $2 AND pay_period_id = $3
         AND paychex_component_id = $4`,
      [workerId, jobSiteId, payPeriodId, mapPayCodeToPaychexComponent('REGULAR')]
    );
    const hoursBefore = Number(beforeAgg.rows[0]?.hours || 0);

    const updated = await updateDailyEntry(created.daily.id, { hours: 5, payCode: 'REGULAR' });
    assert.equal(Number(updated.hours_worked), 5);

    const afterAgg = await query(
      `SELECT hours FROM time_entries
       WHERE worker_id = $1 AND job_site_id = $2 AND pay_period_id = $3
         AND paychex_component_id = $4`,
      [workerId, jobSiteId, payPeriodId, mapPayCodeToPaychexComponent('REGULAR')]
    );
    assert.equal(Number(afterAgg.rows[0].hours), hoursBefore - 8 + 5);
  });

  it('bulk create writes one daily row per worker and reports duplicates without extra rows', async () => {
    const bulkDate = addDays(week1Start, 4);
    const workerIds = secondWorkerId ? [workerId, secondWorkerId] : [workerId];

    const first = await createBulkDailyEntries({
      workerIds,
      jobSiteId,
      payPeriodId,
      payCode: 'REGULAR',
      dateWorked: bulkDate,
      hours: 4,
      enteredBy: null,
    });

    assert.equal(first.createdCount, workerIds.length);
    assert.equal(first.failedCount, 0);
    for (const row of first.results) {
      assert.equal(row.ok, true);
      if (row.entry?.id) createdDailyIds.push(row.entry.id);
    }

    const duplicate = await createBulkDailyEntries({
      workerIds,
      jobSiteId,
      payPeriodId,
      payCode: 'REGULAR',
      dateWorked: bulkDate,
      hours: 4,
      enteredBy: null,
    });

    assert.equal(duplicate.createdCount, 0);
    assert.equal(duplicate.failedCount, workerIds.length);
    for (const row of duplicate.results) {
      assert.equal(row.ok, false);
      assert.equal(row.status, 409);
      assert.match(row.message, /already exists/i);
    }

    const count = await query(
      `SELECT COUNT(*)::int AS n FROM daily_time_entries
       WHERE job_site_id = $1 AND date_worked = $2 AND pay_code = 'REGULAR'
         AND worker_id = ANY($3::uuid[])`,
      [jobSiteId, bulkDate, workerIds]
    );
    assert.equal(count.rows[0].n, workerIds.length);

    if (secondWorkerId) {
      const mixedDate = addDays(week1Start, 5);
      const existing = await createDailyEntry({
        workerId,
        jobSiteId,
        payPeriodId,
        payCode: 'REGULAR',
        dateWorked: mixedDate,
        hours: 2,
        enteredBy: null,
      });
      createdDailyIds.push(existing.daily.id);

      const mixed = await createBulkDailyEntries({
        workerIds: [workerId, secondWorkerId],
        jobSiteId,
        payPeriodId,
        payCode: 'REGULAR',
        dateWorked: mixedDate,
        hours: 2,
        enteredBy: null,
      });

      assert.equal(mixed.createdCount, 1);
      assert.equal(mixed.failedCount, 1);
      const failed = mixed.results.find((row) => !row.ok);
      const created = mixed.results.find((row) => row.ok);
      assert.equal(failed.workerId, String(workerId));
      assert.equal(failed.status, 409);
      assert.equal(created.workerId, String(secondWorkerId));
      if (created.entry?.id) createdDailyIds.push(created.entry.id);

      const mixedCount = await query(
        `SELECT COUNT(*)::int AS n FROM daily_time_entries
         WHERE job_site_id = $1 AND date_worked = $2 AND pay_code = 'REGULAR'
           AND worker_id = ANY($3::uuid[])`,
        [jobSiteId, mixedDate, [workerId, secondWorkerId]]
      );
      assert.equal(mixedCount.rows[0].n, 2);
    }
  });
});

function addDays(dateStr, n) {
  const date = new Date(`${dateStr}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + n);
  return date.toISOString().slice(0, 10);
}
