/**
 * Job Costing service tests — site-scoped SPI-style rows + summary totals.
 */
require('dotenv').config();
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  HOURLY_BY_RATE_FOR_SITE_SQL,
  WORKER_EXTRAS_FOR_SITE_SQL,
  generateJobCostingRows,
  getJobCostingSummary,
} = require('../services/jobCosting');
const { EMPLOYER_LIABILITY_RATE } = require('../services/aggregation');
const { PAY_COMPONENT } = require('../services/paychexExport');

describe('jobCosting SQL shape', () => {
  it('scopes hourly and extras queries to pay period + job site', () => {
    assert.match(HOURLY_BY_RATE_FOR_SITE_SQL, /te\.pay_period_id = \$1/);
    assert.match(HOURLY_BY_RATE_FOR_SITE_SQL, /te\.job_site_id = \$2/);
    assert.match(HOURLY_BY_RATE_FOR_SITE_SQL, /worker_job_site_rates/i);
    assert.match(WORKER_EXTRAS_FOR_SITE_SQL, /te\.pay_period_id = \$1/);
    assert.match(WORKER_EXTRAS_FOR_SITE_SQL, /te\.job_site_id = \$2/);
  });
});

describe('jobCosting integration', () => {
  let skip = false;
  let query;
  let pool;
  let workerId;
  let siteA;
  let siteB;
  let payPeriodId;
  let payPeriodEndDate;
  let employeeCode;
  const createdDailyIds = [];

  before(async () => {
    if (!process.env.DATABASE_URL) {
      skip = true;
      return;
    }
    ({ query, pool } = require('../db'));

    const sites = await query(
      `SELECT id FROM job_sites WHERE is_active = true ORDER BY name LIMIT 2`
    );
    if (sites.rows.length < 2) {
      skip = true;
      return;
    }
    siteA = sites.rows[0];
    siteB = sites.rows[1];

    const period = await query(
      `SELECT id, end_date::text AS end_date,
              week1_start::text AS week1_start
       FROM pay_periods
       WHERE status = 'OPEN'
       ORDER BY start_date DESC
       LIMIT 1`
    );
    if (!period.rows.length || !period.rows[0].week1_start) {
      skip = true;
      return;
    }
    payPeriodId = period.rows[0].id;
    payPeriodEndDate = period.rows[0].end_date;
    const week1Date = period.rows[0].week1_start;

    employeeCode = `JCTEST-${Date.now()}`;
    const workerInsert = await query(
      `INSERT INTO workers (
         employee_code, first_name, last_name, standard_rate, is_active, paychex_worker_id
       ) VALUES ($1, 'Job', 'CostWorker', 20, true, $2)
       RETURNING id`,
      [employeeCode, `pcx-${employeeCode}`]
    );
    workerId = workerInsert.rows[0].id;

    const seeds = [
      { site: siteA.id, code: 'HOURLY', hours: 10, reimb: 0 },
      { site: siteA.id, code: 'OT', hours: 2, reimb: 0 },
      { site: siteA.id, code: 'REIMBURSE', hours: 0, reimb: 50 },
      { site: siteB.id, code: 'HOURLY', hours: 8, reimb: 0 },
    ];

    for (const seed of seeds) {
      const inserted = await query(
        `INSERT INTO daily_time_entries (
           worker_id, job_site_id, pay_period_id, pay_period_end_date,
           date_worked, week_number, pay_code, paychex_component_id,
           component_name, component_rate, hours_worked, reimbursement_amount
         ) VALUES (
           $1, $2, $3, $4::date, $5::date, 1, $6, $6,
           $7, 20, $8, $9
         )
         RETURNING id`,
        [
          workerId,
          seed.site,
          payPeriodId,
          payPeriodEndDate,
          week1Date,
          seed.code,
          seed.code === 'OT' ? 'Overtime' : seed.code === 'REIMBURSE' ? 'Reimbursement' : 'Hourly',
          seed.hours,
          seed.reimb,
        ]
      );
      createdDailyIds.push(inserted.rows[0].id);

      // Dual-write into time_entries (SPI / job costing reads this table).
      await query(
        `INSERT INTO time_entries (
           worker_id, job_site_id, pay_period_id, pay_period_end_date,
           paychex_component_id, component_name, component_rate,
           hours, reimbursement_amount
         ) VALUES ($1, $2, $3, $4::date, $5, $6, 20, $7, $8)
         ON CONFLICT (worker_id, job_site_id, pay_period_id, paychex_component_id)
         DO UPDATE SET
           hours = EXCLUDED.hours,
           reimbursement_amount = EXCLUDED.reimbursement_amount,
           updated_at = now()`,
        [
          workerId,
          seed.site,
          payPeriodId,
          payPeriodEndDate,
          seed.code,
          seed.code === 'OT'
            ? 'Overtime'
            : seed.code === 'REIMBURSE'
              ? 'Reimbursement'
              : 'Hourly',
          seed.hours,
          seed.reimb,
        ]
      );
    }
  });

  after(async () => {
    if (!query) return;
    if (createdDailyIds.length > 0) {
      await query('DELETE FROM daily_time_entries WHERE id = ANY($1::uuid[])', [
        createdDailyIds,
      ]);
    }
    if (workerId && payPeriodId) {
      await query(
        `DELETE FROM time_entries
         WHERE worker_id = $1 AND pay_period_id = $2`,
        [workerId, payPeriodId]
      );
      await query('DELETE FROM workers WHERE id = $1', [workerId]);
    }
    if (pool) await pool.end();
  });

  it('returns per-component rows only for the selected job site', async (t) => {
    if (skip) {
      t.skip('DATABASE_URL / fixtures unavailable');
      return;
    }

    const siteAResult = await generateJobCostingRows(payPeriodId, siteA.id);
    assert.equal(siteAResult.notFound, null);

    const workerRows = siteAResult.rows.filter((r) => r.workerId === employeeCode);
    assert.ok(workerRows.length >= 2, 'expected Hourly + OT (+ optional Reimbursement)');

    const hourly = workerRows.find((r) => r.payComponent === PAY_COMPONENT.HOURLY);
    const overtime = workerRows.find((r) => r.payComponent === PAY_COMPONENT.OVERTIME);
    const reimb = workerRows.find((r) => r.payComponent === PAY_COMPONENT.REIMBURSEMENT);

    assert.ok(hourly, 'Hourly row present');
    assert.equal(hourly.hoursWorked, 10);
    assert.equal(hourly.payRate, 20);
    assert.equal(hourly.worker, 'Job CostWorker');

    assert.ok(overtime, 'Overtime row present');
    assert.equal(overtime.hoursWorked, 2);
    assert.equal(overtime.payRate, null);

    assert.ok(reimb, 'Reimbursement row present');
    assert.equal(reimb.amount, 50);

    // Site B hours must not appear on site A report.
    assert.ok(
      !workerRows.some((r) => r.payComponent === PAY_COMPONENT.HOURLY && r.hoursWorked === 8)
    );

    const siteBResult = await generateJobCostingRows(payPeriodId, siteB.id);
    const siteBWorkerRows = siteBResult.rows.filter((r) => r.workerId === employeeCode);
    const siteBHourly = siteBWorkerRows.find((r) => r.payComponent === PAY_COMPONENT.HOURLY);
    assert.ok(siteBHourly);
    assert.equal(siteBHourly.hoursWorked, 8);
  });

  it('computes SummaryPage-equivalent aggregates for the selected site only', async (t) => {
    if (skip) {
      t.skip('DATABASE_URL / fixtures unavailable');
      return;
    }

    const summary = await getJobCostingSummary(payPeriodId, siteA.id);
    // Site A: 10 regular @ $20 = 200; 2 OT @ $20 * 1.5 = 60; gross = 260
    assert.equal(summary.regularEarnings, 200);
    assert.equal(summary.overtimeEarnings, 60);
    assert.equal(summary.totalEarnings, 260);
    assert.equal(summary.regularHours, 10);
    assert.equal(summary.overtimeHours, 2);
    assert.equal(summary.totalHours, 12);
    assert.equal(summary.internalReimbursements, 50);
    assert.equal(summary.paychexRecurringReimbursements, 0);
    assert.equal(summary.totalReimbursements, 50);
    assert.equal(summary.employerLiability, 260 * EMPLOYER_LIABILITY_RATE);
    assert.equal(
      summary.cashRequirements,
      summary.totalEarnings + summary.totalReimbursements + summary.employerLiability
    );
  });
});
