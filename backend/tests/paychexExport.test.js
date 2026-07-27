/**
 * SPI / payroll export tests.
 *
 * Unit tests always run. The integration suite seeds time_entries when
 * DATABASE_URL is available (same pattern as aggregation.test.js).
 */
require('dotenv').config();
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  EXPORT_CSV_HEADERS,
  AGGREGATION_SQL,
  computeTotalAmount,
  displayHourlyHours,
  displayOvertimeHours,
  validateSpiRows,
  generateSPICSV,
  generateSPIRows,
  sumRowHours,
  formatHours,
  formatMoney,
} = require('../services/paychexExport');

describe('paychexExport worker-only SPI shape', () => {
  it('exports target column headers in order without Job', () => {
    assert.deepEqual(EXPORT_CSV_HEADERS, [
      'Name',
      'Employee ID',
      'Total Amount',
      'Hourly Hours',
      'Hourly Rate',
      'Overtime Hours',
      'Reimbursement Amount',
      'Short Pay Amount',
    ]);
    assert.ok(!EXPORT_CSV_HEADERS.includes('Job'));
  });

  it('AGGREGATION_SQL groups by worker only — no job_sites join', () => {
    assert.doesNotMatch(AGGREGATION_SQL, /job_sites/i);
    assert.doesNotMatch(AGGREGATION_SQL, /job_site_id/i);
    assert.match(AGGREGATION_SQL, /GROUP BY\s+w\.id/i);
  });

  it('merges hourly + PTO into display hourly hours and OT + DT into overtime', () => {
    const agg = {
      hourly_hours: 80,
      overtime_hours: 10,
      doubletime_hours: 2,
      pto_hours: 4,
    };
    assert.equal(displayHourlyHours(agg), 84);
    assert.equal(displayOvertimeHours(agg), 12);
  });

  it('computes Total Amount with OT 1.5× and DT 2× plus reimbursement minus short pay', () => {
    // 80 × 21 + 10 × 21 × 1.5 = 1680 + 315 = 1995
    assert.equal(
      computeTotalAmount({
        hourlyHours: 80,
        overtimeHours: 10,
        hourlyRate: 21,
      }),
      1995
    );
    // John Smith style: 80 × 21 = 1680
    assert.equal(
      computeTotalAmount({
        hourlyHours: 80,
        overtimeHours: 0,
        hourlyRate: 21,
      }),
      1680
    );
    // DT at 2×
    assert.equal(
      computeTotalAmount({
        hourlyHours: 0,
        overtimeHours: 0,
        doubletimeHours: 10,
        hourlyRate: 20,
      }),
      400
    );
    // + reimbursement − short pay
    assert.equal(
      computeTotalAmount({
        hourlyHours: 80,
        overtimeHours: 0,
        hourlyRate: 21,
        reimbursementAmount: 100,
        shortPayAmount: 25,
      }),
      1755
    );
  });

  it('formats hours to 1 decimal and money to 2 decimals', () => {
    assert.equal(formatHours(80), '80.0');
    assert.equal(formatHours(10.25), '10.3');
    assert.equal(formatMoney(1680), '1680.00');
  });

  it('sums hourly + overtime for period hour reconciliation', () => {
    const rows = [
      { 'Hourly Hours': '80.0', 'Overtime Hours': '10.0' },
      { 'Hourly Hours': '45.0', 'Overtime Hours': '0.0' },
      { 'Hourly Hours': '0.0', 'Overtime Hours': '10.0' },
    ];
    const total = rows.reduce((sum, row) => sum + sumRowHours(row), 0);
    assert.equal(total, 145);
  });

  it('validates required name and employee id; allows reimbursement-only rows', () => {
    const errors = validateSpiRows([
      {
        Name: 'Jane',
        'Employee ID': '',
        'Hourly Hours': '8.0',
        'Overtime Hours': '0.0',
        'Reimbursement Amount': '0.00',
      },
      {
        Name: 'Bob',
        'Employee ID': '99',
        'Hourly Hours': '0.0',
        'Overtime Hours': '0.0',
        'Reimbursement Amount': '25.00',
      },
    ]);
    assert.ok(errors.some((e) => e.row === 0 && /Employee ID/i.test(e.reason)));
    assert.ok(!errors.some((e) => e.row === 1));
  });

  it('CSV uses the new headers and omits Job / job site names', () => {
    const { csvString, filename } = generateSPICSV(
      [
        {
          Name: 'Edgar Jose Aguilar Rios',
          'Employee ID': '42',
          'Total Amount': '1995.00',
          Job: 'TXDOT - Bell County',
          'Hourly Hours': '80.0',
          'Hourly Rate': '21.00',
          'Overtime Hours': '10.0',
          'Reimbursement Amount': '0.00',
          'Short Pay Amount': '0.00',
          _workerDbId: 'ignore',
          _jobName: 'TXDOT - Bell County',
        },
      ],
      'demo'
    );
    assert.equal(filename, 'demo_ta.csv');
    const lines = csvString.split('\n');
    assert.equal(lines[0], EXPORT_CSV_HEADERS.join(','));
    assert.ok(!lines[0].includes('Job'));
    assert.match(lines[1], /Edgar Jose Aguilar Rios/);
    assert.match(lines[1], /80\.0/);
    assert.match(lines[1], /10\.0/);
    assert.ok(!csvString.includes('TXDOT'));
    assert.ok(!csvString.includes('Bell County'));
    assert.ok(!csvString.includes('Pay Component'));
  });
});

describe('generateSPIRows worker×period rollup (integration)', () => {
  let query;
  let pool;
  let workerId;
  let employeeCode;
  let siteA;
  let siteB;
  let payPeriodId;
  const createdTimeEntryIds = [];
  let skip = false;
  const RATE = 25;

  before(async () => {
    if (!process.env.DATABASE_URL) {
      skip = true;
      return;
    }
    ({ query, pool } = require('../db'));

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
      `SELECT id FROM pay_periods WHERE status = 'OPEN' ORDER BY start_date DESC LIMIT 1`
    );
    if (!period.rows.length) {
      skip = true;
      return;
    }
    payPeriodId = period.rows[0].id;

    employeeCode = `SPITEST-${Date.now()}`;
    const workerInsert = await query(
      `INSERT INTO workers (
         employee_code, first_name, last_name, standard_rate, is_active, paychex_worker_id
       ) VALUES ($1, 'Spi', 'TestWorker', $2, true, $3)
       RETURNING id`,
      [employeeCode, RATE, `pcx-${employeeCode}`]
    );
    workerId = workerInsert.rows[0].id;
  });

  after(async () => {
    if (!query) return;
    if (createdTimeEntryIds.length > 0) {
      await query('DELETE FROM time_entries WHERE id = ANY($1::uuid[])', [
        createdTimeEntryIds,
      ]);
    }
    if (workerId) {
      await query('DELETE FROM workers WHERE id = $1', [workerId]);
    }
    if (pool) await pool.end();
  });

  it('rolls hours across multiple job sites into one SPI row', async (t) => {
    if (skip) {
      t.skip('DATABASE_URL / fixtures unavailable');
      return;
    }

    // Site A: 40 REG + 5 OT; Site B: 32 REG + 3 OT → one worker row: 72 hourly, 8 OT
    const seed = [
      { site: siteA.id, component: 'HOURLY', hours: 40 },
      { site: siteA.id, component: 'OT', hours: 5 },
      { site: siteB.id, component: 'HOURLY', hours: 32 },
      { site: siteB.id, component: 'OT', hours: 3 },
    ];

    const endDateResult = await query(
      `SELECT end_date::text AS end_date FROM pay_periods WHERE id = $1`,
      [payPeriodId]
    );
    const payPeriodEndDate = endDateResult.rows[0].end_date;

    let expectedWage = 0;
    for (const row of seed) {
      const hours = Number(row.hours);
      const isOt = row.component === 'OT';
      expectedWage += isOt ? hours * RATE * 1.5 : hours * RATE;

      const inserted = await query(
        `INSERT INTO time_entries (
           worker_id, job_site_id, pay_period_id, pay_period_end_date,
           paychex_component_id, component_name, hours, reimbursement_amount
         ) VALUES ($1, $2, $3, $4::date, $5, $5, $6::numeric, 0)
         RETURNING id`,
        [workerId, row.site, payPeriodId, payPeriodEndDate, row.component, hours]
      );
      createdTimeEntryIds.push(inserted.rows[0].id);
    }

    const { rows, notFound } = await generateSPIRows(payPeriodId);
    assert.ok(!notFound);

    const workerRows = rows.filter(
      (r) => String(r['Employee ID']) === String(employeeCode)
    );
    assert.equal(
      workerRows.length,
      1,
      `expected exactly one SPI row for ${employeeCode}, got ${workerRows.length}`
    );

    const row = workerRows[0];
    assert.equal(row['Hourly Hours'], '72.0');
    assert.equal(row['Overtime Hours'], '8.0');
    assert.equal(row['Hourly Rate'], '25.00');
    assert.equal(Number(row['Total Amount']), expectedWage);
    assert.equal(
      Number(row['Total Amount']),
      computeTotalAmount({
        hourlyHours: 72,
        overtimeHours: 8,
        hourlyRate: RATE,
      })
    );

    const { csvString } = generateSPICSV(workerRows, '70205967');
    const header = csvString.split('\n')[0];
    assert.equal(header, EXPORT_CSV_HEADERS.join(','));
    assert.ok(!header.includes('Job'));
    assert.ok(!csvString.includes(siteA.name));
    assert.ok(!csvString.includes(siteB.name));
  });
});
