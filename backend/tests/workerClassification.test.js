/**
 * Worker labor classification assignment + certified payroll reads.
 * Requires DATABASE_URL and migration 009 applied.
 *
 * Run: npm test
 */
require('dotenv').config();
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { query, pool } = require('../db');
const { createDailyEntry } = require('../services/dailyEntryService');
const { loadHoursRows } = require('../services/certifiedPayrollService');

describe('worker labor classification', () => {
  let workerId;
  let jobSiteId;
  let payPeriodId;
  let week1Start;
  let week1End;
  let classificationId;
  let classificationName;
  const createdDailyIds = [];
  let previousClassificationId = null;

  before(async () => {
    const columnCheck = await query(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_name = 'workers'
         AND column_name = 'labor_classification_id'`
    );
    assert.ok(columnCheck.rows.length > 0, 'Run migration 009 first (npm run migrate:009)');

    const workerResult = await query(
      `SELECT id, labor_classification_id
       FROM workers
       WHERE is_active = true AND standard_rate IS NOT NULL
       LIMIT 1`
    );
    assert.ok(workerResult.rows.length > 0, 'Need at least one active worker with a rate');
    workerId = workerResult.rows[0].id;
    previousClassificationId = workerResult.rows[0].labor_classification_id;

    const siteResult = await query(`SELECT id FROM job_sites WHERE is_active = true LIMIT 1`);
    assert.ok(siteResult.rows.length > 0, 'Need at least one active job site');
    jobSiteId = siteResult.rows[0].id;

    const periodResult = await query(
      `SELECT id, week1_start::text, week1_end::text
       FROM pay_periods
       WHERE status = 'OPEN'
       ORDER BY start_date DESC
       LIMIT 1`
    );
    assert.ok(periodResult.rows.length > 0, 'Need an open pay period');
    payPeriodId = periodResult.rows[0].id;
    week1Start = periodResult.rows[0].week1_start;
    week1End = periodResult.rows[0].week1_end;

    const classResult = await query(`SELECT id, name FROM labor_classifications LIMIT 1`);
    assert.ok(classResult.rows.length > 0, 'Need at least one labor classification');
    classificationId = classResult.rows[0].id;
    classificationName = classResult.rows[0].name;

    await query(`UPDATE workers SET labor_classification_id = $1 WHERE id = $2`, [
      classificationId,
      workerId,
    ]);
  });

  after(async () => {
    if (createdDailyIds.length > 0) {
      await query('DELETE FROM daily_time_entries WHERE id = ANY($1::uuid[])', [createdDailyIds]);
      await query(
        `DELETE FROM time_entries
         WHERE worker_id = $1 AND job_site_id = $2 AND pay_period_id = $3`,
        [workerId, jobSiteId, payPeriodId]
      );
    }

    await query(`UPDATE workers SET labor_classification_id = $1 WHERE id = $2`, [
      previousClassificationId,
      workerId,
    ]);
    await pool.end();
  });

  it('stores classification on workers via labor_classification_id', async () => {
    const result = await query(
      `SELECT w.labor_classification_id, lc.name
       FROM workers w
       LEFT JOIN labor_classifications lc ON w.labor_classification_id = lc.id
       WHERE w.id = $1`,
      [workerId]
    );
    assert.equal(result.rows[0].labor_classification_id, classificationId);
    assert.equal(result.rows[0].name, classificationName);
  });

  it('creates daily entries without a classification field', async () => {
    const uniqueDay = new Date(`${week1Start}T12:00:00Z`);
    uniqueDay.setUTCDate(uniqueDay.getUTCDate() + 3);

    const result = await createDailyEntry({
      workerId,
      jobSiteId,
      payPeriodId,
      payCode: 'PTO',
      dateWorked: uniqueDay.toISOString().slice(0, 10),
      hours: 4,
      enteredBy: null,
    });
    createdDailyIds.push(result.daily.id);

    assert.equal(result.daily.labor_classification_id, null);
    assert.equal(Number(result.daily.hours_worked), 4);
  });

  it('returns worker classification in certified payroll hour rows', async () => {
    const hourLogDay = week1End;
    const existing = await query(
      `SELECT id FROM daily_time_entries
       WHERE worker_id = $1
         AND job_site_id = $2
         AND date_worked = $3
         AND paychex_component_id = 'REGULAR'`,
      [workerId, jobSiteId, hourLogDay]
    );

    if (existing.rows.length === 0) {
      const result = await createDailyEntry({
        workerId,
        jobSiteId,
        payPeriodId,
        payCode: 'REGULAR',
        dateWorked: hourLogDay,
        hours: 1,
        enteredBy: null,
      });
      createdDailyIds.push(result.daily.id);
    }

    const rows = await loadHoursRows(jobSiteId, week1End);
    const workerRows = rows.filter((row) => row.id === workerId);
    assert.ok(workerRows.length > 0, 'Expected certified payroll rows for test worker');
    assert.equal(workerRows[0].labor_classification, classificationName);
  });

  it('clears worker classification when set to null', async () => {
    await query(`UPDATE workers SET labor_classification_id = NULL WHERE id = $1`, [workerId]);
    const rows = await loadHoursRows(jobSiteId, week1End);
    const workerRows = rows.filter((row) => row.id === workerId);
    assert.ok(workerRows.length > 0);
    assert.equal(workerRows[0].labor_classification, null);

    await query(`UPDATE workers SET labor_classification_id = $1 WHERE id = $2`, [
      classificationId,
      workerId,
    ]);
  });
});
