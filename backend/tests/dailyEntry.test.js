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
const { createDailyEntry } = require('../services/dailyEntryService');
const { loadHoursRows } = require('../services/certifiedPayrollService');

function toDateStr(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).split('T')[0];
}

describe('daily entry dual-write', () => {
  let workerId;
  let jobSiteId;
  let payPeriodId;
  let payPeriodEndDate;
  let week1Start;
  let week1End;
  const createdDailyIds = [];

  before(async () => {
    const workerResult = await query(
      `SELECT id FROM workers WHERE is_active = true AND standard_rate IS NOT NULL LIMIT 1`
    );
    assert.ok(workerResult.rows.length > 0, 'Need at least one active worker with a rate');
    workerId = workerResult.rows[0].id;

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
         WHERE worker_id = $1 AND job_site_id = $2 AND pay_period_id = $3`,
        [workerId, jobSiteId, payPeriodId]
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
});
