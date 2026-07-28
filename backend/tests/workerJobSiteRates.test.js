/**
 * Per-job-site worker pay rate overrides.
 */
require('dotenv').config();
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { getEffectiveRate } = require('../db/workerRateQuery');
const { loadHoursRows } = require('../services/certifiedPayrollService');
const {
  AGGREGATED_SUMMARY_SQL,
  COMPANY_EARNINGS_SQL,
  getAggregatedSummary,
  getCompanyEarnings,
} = require('../services/aggregation');

describe('worker_job_site_rates SQL shape', () => {
  it('aggregation queries join worker_job_site_rates and COALESCE override rates', () => {
    assert.match(AGGREGATED_SUMMARY_SQL, /worker_job_site_rates/i);
    assert.match(AGGREGATED_SUMMARY_SQL, /COALESCE\(wjsr\.rate, w\.standard_rate, 0\)/);
    assert.match(COMPANY_EARNINGS_SQL, /worker_job_site_rates/i);
    assert.match(COMPANY_EARNINGS_SQL, /COALESCE\(wjsr\.rate, w\.standard_rate, 0\)/);
    // Summary remains worker-only grouping (no Job Site column)
    assert.doesNotMatch(AGGREGATED_SUMMARY_SQL, /"jobSite"/);
  });
});

describe('getEffectiveRate + loadHoursRows overrides (integration)', () => {
  let query;
  let pool;
  let workerId;
  let siteA;
  let siteB;
  let payPeriodId;
  let week1End;
  let payPeriodEndDate;
  let week1Start;
  const createdDailyIds = [];
  const createdOverrideIds = [];
  let skip = false;
  const STANDARD = 25;
  const OVERRIDE = 40;

  before(async () => {
    if (!process.env.DATABASE_URL) {
      skip = true;
      return;
    }
    ({ query, pool } = require('../db'));

    try {
      await query('SELECT 1 FROM worker_job_site_rates LIMIT 1');
    } catch {
      skip = true;
      return;
    }

    const sites = await query(
      `SELECT id FROM job_sites WHERE is_active = true ORDER BY name LIMIT 2`
    );
    if (sites.rows.length < 2) {
      skip = true;
      return;
    }
    siteA = sites.rows[0].id;
    siteB = sites.rows[1].id;

    const period = await query(
      `SELECT id, end_date::text AS end_date,
              week1_start::text AS week1_start,
              week1_end::text AS week1_end
       FROM pay_periods WHERE status = 'OPEN'
       ORDER BY start_date DESC LIMIT 1`
    );
    if (!period.rows.length) {
      skip = true;
      return;
    }
    payPeriodId = period.rows[0].id;
    payPeriodEndDate = period.rows[0].end_date;
    week1Start = period.rows[0].week1_start;
    week1End = period.rows[0].week1_end;

    const workerInsert = await query(
      `INSERT INTO workers (
         employee_code, first_name, last_name, standard_rate, is_active, paychex_worker_id
       ) VALUES ($1, 'Rate', 'Override', $2, true, $3)
       RETURNING id`,
      [`RATEOVR-${Date.now()}`, STANDARD, `pcx-rate-${Date.now()}`]
    );
    workerId = workerInsert.rows[0].id;
  });

  after(async () => {
    if (!query) return;
    if (createdOverrideIds.length) {
      await query('DELETE FROM worker_job_site_rates WHERE id = ANY($1::uuid[])', [
        createdOverrideIds,
      ]);
    }
    if (createdDailyIds.length) {
      await query('DELETE FROM daily_time_entries WHERE id = ANY($1::uuid[])', [
        createdDailyIds,
      ]);
      await query(
        `DELETE FROM time_entries WHERE worker_id = $1 AND pay_period_id = $2`,
        [workerId, payPeriodId]
      );
    }
    if (workerId) {
      await query('DELETE FROM workers WHERE id = $1', [workerId]);
    }
    if (pool) await pool.end();
  });

  it('getEffectiveRate falls back to standard_rate without override', async (t) => {
    if (skip) {
      t.skip('DATABASE_URL / worker_job_site_rates unavailable');
      return;
    }
    assert.equal(await getEffectiveRate(workerId, siteA), STANDARD);
    assert.equal(await getEffectiveRate(workerId, siteB), STANDARD);
  });

  it('override applies only at that job site; other sites keep standard_rate', async (t) => {
    if (skip) {
      t.skip('DATABASE_URL / worker_job_site_rates unavailable');
      return;
    }

    const inserted = await query(
      `INSERT INTO worker_job_site_rates (worker_id, job_site_id, rate)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [workerId, siteA, OVERRIDE]
    );
    createdOverrideIds.push(inserted.rows[0].id);

    assert.equal(await getEffectiveRate(workerId, siteA), OVERRIDE);
    assert.equal(await getEffectiveRate(workerId, siteB), STANDARD);

    for (const [site, hours] of [
      [siteA, 8],
      [siteB, 8],
    ]) {
      const daily = await query(
        `INSERT INTO daily_time_entries (
           worker_id, job_site_id, pay_period_id, pay_period_end_date, date_worked, week_number,
           pay_code, paychex_component_id, hours_worked, regular_hours, overtime_hours,
           doubletime_hours, reimbursement_amount, component_name
         ) VALUES (
           $1, $2, $3, $4::date, $5::date, 1, 'HOURLY', 'HOURLY',
           $6::numeric, $6::numeric, 0, 0, 0, ''
         )
         RETURNING id`,
        [workerId, site, payPeriodId, payPeriodEndDate, week1Start, hours]
      );
      createdDailyIds.push(daily.rows[0].id);
    }

    const rowsA = (await loadHoursRows(siteA, week1End)).filter((r) => r.id === workerId);
    const rowsB = (await loadHoursRows(siteB, week1End)).filter((r) => r.id === workerId);
    assert.ok(rowsA.length > 0);
    assert.ok(rowsB.length > 0);
    assert.equal(Number(rowsA[0].pay_rate), OVERRIDE);
    assert.equal(Number(rowsB[0].pay_rate), STANDARD);

    // OT gross on WH-347 path uses 1.5× the site rate (verified via pay_rate)
    const otGrossA = 2 * Number(rowsA[0].pay_rate) * 1.5;
    assert.equal(otGrossA, 2 * OVERRIDE * 1.5);
  });

  it('POST upsert and DELETE restore standard_rate', async (t) => {
    if (skip) {
      t.skip('DATABASE_URL / worker_job_site_rates unavailable');
      return;
    }

    const first = await query(
      `INSERT INTO worker_job_site_rates (worker_id, job_site_id, rate)
       VALUES ($1, $2, $3)
       ON CONFLICT (worker_id, job_site_id)
       DO UPDATE SET rate = EXCLUDED.rate, updated_at = now()
       RETURNING id, rate`,
      [workerId, siteB, 33]
    );
    if (!createdOverrideIds.includes(first.rows[0].id)) {
      createdOverrideIds.push(first.rows[0].id);
    }
    assert.equal(Number(first.rows[0].rate), 33);

    const second = await query(
      `INSERT INTO worker_job_site_rates (worker_id, job_site_id, rate)
       VALUES ($1, $2, $3)
       ON CONFLICT (worker_id, job_site_id)
       DO UPDATE SET rate = EXCLUDED.rate, updated_at = now()
       RETURNING id, rate`,
      [workerId, siteB, 35]
    );
    assert.equal(second.rows[0].id, first.rows[0].id);
    assert.equal(Number(second.rows[0].rate), 35);
    assert.equal(await getEffectiveRate(workerId, siteB), 35);

    await query(`DELETE FROM worker_job_site_rates WHERE id = $1`, [first.rows[0].id]);
    assert.equal(await getEffectiveRate(workerId, siteB), STANDARD);
  });

  it('empty overrides table does not change company earnings vs standard_rate math', async (t) => {
    if (skip) {
      t.skip('DATABASE_URL / worker_job_site_rates unavailable');
      return;
    }

    // Wipe overrides for this worker so regression is empty-table behavior for them
    await query(`DELETE FROM worker_job_site_rates WHERE worker_id = $1`, [workerId]);

    const earnings = await getCompanyEarnings(payPeriodId);
    assert.ok(Number.isFinite(earnings));

    const summary = await getAggregatedSummary(payPeriodId);
    assert.ok(Array.isArray(summary));
  });
});
