/**
 * Aggregation summary tests.
 *
 * Unit tests always run. The integration suite seeds daily_time_entries when
 * DATABASE_URL is available (same pattern as dailyEntry.test.js).
 */
require('dotenv').config();
const { describe, it, before, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const {
  AGGREGATED_SUMMARY_SQL,
  CSV_HEADERS,
  CSV_FIELD_MAP,
  generateCSV,
} = require('../services/aggregation');

describe('AGGREGATED_SUMMARY_SQL shape', () => {
  it('groups by worker only — no job site join or column', () => {
    assert.doesNotMatch(AGGREGATED_SUMMARY_SQL, /job_sites/i);
    assert.doesNotMatch(AGGREGATED_SUMMARY_SQL, /"jobSite"/);
    assert.match(
      AGGREGATED_SUMMARY_SQL,
      /GROUP BY\s+w\.employee_code,\s*w\.first_name,\s*w\.last_name/i
    );
    assert.match(
      AGGREGATED_SUMMARY_SQL,
      /ORDER BY\s+w\.last_name,\s*w\.first_name\s*;/i
    );
  });

  it('treats HOURLY/REGULAR variants as regular hours', () => {
    assert.match(
      AGGREGATED_SUMMARY_SQL,
      /pay_code IN \('REGULAR', 'HOURLY', 'Regular', 'Hourly'\)/
    );
    // OT filter unchanged
    assert.match(AGGREGATED_SUMMARY_SQL, /pay_code = 'OT'/);
    // No bare REGULAR-only filters left for the regular columns
    assert.doesNotMatch(
      AGGREGATED_SUMMARY_SQL,
      /pay_code = 'REGULAR'/
    );
  });
});

describe('CSV export without Job Site', () => {
  it('keeps CSV_HEADERS and CSV_FIELD_MAP aligned without jobSite', () => {
    assert.equal(CSV_HEADERS.length, CSV_FIELD_MAP.length);
    assert.ok(!CSV_HEADERS.includes('Job Site'));
    assert.ok(!CSV_FIELD_MAP.includes('jobSite'));
    assert.deepEqual(CSV_HEADERS, [
      'Employee ID',
      'First Name',
      'Last Name',
      'Week 1 Regular',
      'Week 1 Overtime',
      'Week 1 Total',
      'Week 2 Regular',
      'Week 2 Overtime',
      'Week 2 Total',
      'Total Regular',
      'Total Overtime',
      'Total Working Hours',
      'Truck Reimbursements',
      'Reimbursements',
      'Total',
    ]);
    assert.deepEqual(CSV_FIELD_MAP, [
      'employeeId',
      'firstName',
      'lastName',
      'week1Regular',
      'week1Overtime',
      'week1Total',
      'week2Regular',
      'week2Overtime',
      'week2Total',
      'totalRegular',
      'totalOvertime',
      'totalHours',
      'truckReimbursement',
      'otherReimbursements',
      'total',
    ]);
  });

  it('generateCSV omits Job Site header and job site name strings', () => {
    const rows = [
      {
        employeeId: '101',
        firstName: 'Jane',
        lastName: 'Doe',
        week1Regular: 32,
        week1Overtime: 4,
        week1Total: 36,
        week2Regular: 40,
        week2Overtime: 2,
        week2Total: 42,
        totalRegular: 72,
        totalOvertime: 6,
        totalHours: 78,
        truckReimbursement: 0,
        otherReimbursements: 25,
        total: 1545,
        // leftover field must not leak into CSV
        jobSite: 'TXDOT - Bell County',
      },
    ];
    const csv = generateCSV(rows);
    const header = csv.split('\n')[0];
    assert.ok(!header.includes('Job Site'));
    assert.ok(!csv.includes('TXDOT'));
    assert.ok(!csv.includes('Bell County'));
    assert.match(csv, /^Employee ID,First Name,Last Name,Week 1 Regular/);
  });
});

describe('getAggregatedSummary worker×period rollup (integration)', () => {
  let query;
  let pool;
  let getAggregatedSummary;
  let workerId;
  let employeeCode;
  let siteA;
  let siteB;
  let payPeriodId;
  let week1Date;
  let week2Date;
  let payPeriodEndDate;
  const createdDailyIds = [];
  let skip = false;

  before(async () => {
    if (!process.env.DATABASE_URL) {
      skip = true;
      return;
    }
    ({ query, pool } = require('../db'));
    delete require.cache[require.resolve('../services/aggregation')];
    ({ getAggregatedSummary } = require('../services/aggregation'));

    const sites = await query(
      `SELECT id, name FROM job_sites WHERE is_active = true ORDER BY name LIMIT 2`
    );
    if (sites.rows.length < 2) {
      skip = true;
      return;
    }
    siteA = sites.rows[0];
    siteB = sites.rows[1];

    const period = await query(
      `SELECT id,
              week1_start::text AS week1_start,
              week2_start::text AS week2_start
       FROM pay_periods
       WHERE status = 'OPEN'
       ORDER BY start_date DESC
       LIMIT 1`
    );
    if (!period.rows.length || !period.rows[0].week1_start || !period.rows[0].week2_start) {
      skip = true;
      return;
    }
    payPeriodId = period.rows[0].id;
    week1Date = period.rows[0].week1_start;
    week2Date = period.rows[0].week2_start;

    const endDateResult = await query(
      `SELECT end_date::text AS end_date FROM pay_periods WHERE id = $1`,
      [payPeriodId]
    );
    payPeriodEndDate = endDateResult.rows[0].end_date;

    // Isolated worker so existing pay-period hours cannot skew assertions.
    employeeCode = `AGGTEST-${Date.now()}`;
    const workerInsert = await query(
      `INSERT INTO workers (
         employee_code, first_name, last_name, standard_rate, is_active, paychex_worker_id
       ) VALUES ($1, 'Agg', 'TestWorker', 25, true, $2)
       RETURNING id`,
      [employeeCode, `pcx-${employeeCode}`]
    );
    workerId = workerInsert.rows[0].id;
  });

  after(async () => {
    if (!query) return;
    if (createdDailyIds.length > 0) {
      await query('DELETE FROM daily_time_entries WHERE id = ANY($1::uuid[])', [
        createdDailyIds,
      ]);
    }
    if (workerId) {
      await query('DELETE FROM workers WHERE id = $1', [workerId]);
    }
    if (pool) await pool.end();
  });

  it('rolls HOURLY + OT across multiple job sites into one worker row', async (t) => {
    if (skip) {
      t.skip('DATABASE_URL / fixtures unavailable');
      return;
    }

    const seed = [
      { site: siteA.id, week: 1, date: week1Date, code: 'HOURLY', hours: 20 },
      { site: siteA.id, week: 1, date: week1Date, code: 'OT', hours: 2 },
      { site: siteB.id, week: 1, date: week1Date, code: 'HOURLY', hours: 12 },
      { site: siteA.id, week: 2, date: week2Date, code: 'HOURLY', hours: 16 },
      { site: siteA.id, week: 2, date: week2Date, code: 'OT', hours: 4 },
      { site: siteB.id, week: 2, date: week2Date, code: 'HOURLY', hours: 24 },
      { site: siteB.id, week: 2, date: week2Date, code: 'OT', hours: 1 },
    ];

    const expected = {
      week1Regular: 32,
      week1Overtime: 2,
      week2Regular: 40,
      week2Overtime: 5,
      totalRegular: 72,
      totalOvertime: 7,
    };

    for (const row of seed) {
      const hours = Number(row.hours);
      const inserted = await query(
        `INSERT INTO daily_time_entries (
           worker_id, job_site_id, pay_period_id, pay_period_end_date, date_worked, week_number,
           pay_code, paychex_component_id, hours_worked, regular_hours, overtime_hours,
           doubletime_hours, reimbursement_amount, component_name
         ) VALUES (
           $1, $2, $3, $4::date, $5::date, $6, $7, $7,
           $8::numeric,
           CASE WHEN $7 = 'OT' THEN 0 ELSE $8::numeric END,
           CASE WHEN $7 = 'OT' THEN $8::numeric ELSE 0 END,
           0, 0, ''
         )
         RETURNING id`,
        [
          workerId,
          row.site,
          payPeriodId,
          payPeriodEndDate,
          row.date,
          row.week,
          row.code,
          hours,
        ]
      );
      createdDailyIds.push(inserted.rows[0].id);
    }

    // Pre-change equivalent: sum of all seeded hours (what per-job-site rows would total).
    const perSite = await query(
      `SELECT
         COALESCE(SUM(CASE WHEN pay_code IN ('REGULAR','HOURLY','Regular','Hourly') THEN hours_worked END), 0) AS reg,
         COALESCE(SUM(CASE WHEN pay_code = 'OT' THEN hours_worked END), 0) AS ot
       FROM daily_time_entries
       WHERE id = ANY($1::uuid[])`,
      [createdDailyIds]
    );
    const preChangeRegular = Number(perSite.rows[0].reg);
    const preChangeOvertime = Number(perSite.rows[0].ot);
    assert.equal(preChangeRegular, expected.totalRegular);
    assert.equal(preChangeOvertime, expected.totalOvertime);

    const rows = await getAggregatedSummary(payPeriodId);
    const workerRows = rows.filter((r) => String(r.employeeId) === String(employeeCode));
    assert.equal(
      workerRows.length,
      1,
      `expected exactly one row for employee ${employeeCode}, got ${workerRows.length}`
    );

    const row = workerRows[0];
    assert.equal(Number(row.week1Regular), expected.week1Regular);
    assert.equal(Number(row.week2Regular), expected.week2Regular);
    assert.equal(Number(row.totalRegular), expected.totalRegular);
    assert.ok(Number(row.totalRegular) > 0, 'totalRegular must be non-zero for HOURLY hours');
    assert.equal(Number(row.week1Overtime), expected.week1Overtime);
    assert.equal(Number(row.week2Overtime), expected.week2Overtime);
    assert.equal(Number(row.totalOvertime), expected.totalOvertime);

    // Grand totals match pre-change per-job-site sum (no data loss from re-aggregation)
    assert.equal(Number(row.totalRegular), preChangeRegular);
    assert.equal(Number(row.totalOvertime), preChangeOvertime);

    const csv = generateCSV(workerRows);
    assert.ok(!csv.includes('Job Site'));
    assert.ok(!csv.includes(siteA.name));
    assert.ok(!csv.includes(siteB.name));
  });
});
