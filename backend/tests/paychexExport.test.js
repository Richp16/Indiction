/**
 * SPI / Paychex import export tests (pay-component rows).
 *
 * Unit tests always run. Integration suite seeds time_entries when
 * DATABASE_URL is available.
 */
require('dotenv').config();
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  EXPORT_CSV_HEADERS,
  PAY_COMPONENT,
  PAYCHEX_COMPANY_ID,
  HOURLY_BY_RATE_SQL,
  computeTotalAmount,
  displayHourlyHours,
  displayOvertimeHours,
  validateSpiRows,
  generateSPICSV,
  generateSPIRows,
  sumRowHours,
  formatPaychexNumber,
  stripMetadata,
} = require('../services/paychexExport');

const EXPECTED_HEADER =
  'Company ID,Worker ID,Org,Job Number,Job Name,Pay Component,Rate,Rate #,Hours,Units,Line Date,Amount,Check Seq Number,Override State,Override Local,Override Local Jurisdiction,Labor Override';

describe('paychexExport Paychex_Import SPI shape', () => {
  it('exports Paychex_Import.csv headers in exact order', () => {
    assert.deepEqual(EXPORT_CSV_HEADERS, [
      'Company ID',
      'Worker ID',
      'Org',
      'Job Number',
      'Job Name',
      'Pay Component',
      'Rate',
      'Rate #',
      'Hours',
      'Units',
      'Line Date',
      'Amount',
      'Check Seq Number',
      'Override State',
      'Override Local',
      'Override Local Jurisdiction',
      'Labor Override',
    ]);
    assert.equal(EXPORT_CSV_HEADERS.join(','), EXPECTED_HEADER);
  });

  it('hourly SQL groups by worker + effective rate (not job site)', () => {
    assert.match(
      HOURLY_BY_RATE_SQL,
      /GROUP BY[\s\S]*COALESCE\(wjsr\.rate, w\.standard_rate, 0\)/i
    );
    assert.doesNotMatch(HOURLY_BY_RATE_SQL, /GROUP BY[\s\S]*te\.job_site_id/i);
    assert.match(HOURLY_BY_RATE_SQL, /worker_job_site_rates/i);
  });

  it('merges hourly + PTO and OT + DT for display helpers', () => {
    assert.equal(
      displayHourlyHours({ hourly_hours: 80, pto_hours: 4 }),
      84
    );
    assert.equal(
      displayOvertimeHours({ overtime_hours: 10, doubletime_hours: 2 }),
      12
    );
  });

  it('formatPaychexNumber matches import-style whole numbers', () => {
    assert.equal(formatPaychexNumber(20), '20');
    assert.equal(formatPaychexNumber(40.0), '40');
    assert.equal(formatPaychexNumber(500), '500');
    assert.equal(formatPaychexNumber(10.5), '10.5');
  });

  it('sums Hours on Hourly/Overtime component rows', () => {
    const rows = [
      { 'Pay Component': 'Hourly', Hours: '40' },
      { 'Pay Component': 'Overtime', Hours: '10' },
      { 'Pay Component': 'Reimbursement', Amount: '500', Hours: '' },
    ];
    const total = rows.reduce((sum, row) => sum + sumRowHours(row), 0);
    assert.equal(total, 50);
  });

  it('CSV header line matches Paychex_Import.csv byte-for-byte', () => {
    const { csvString } = generateSPICSV(
      [
        {
          'Company ID': '70205967',
          'Worker ID': '11',
          Org: '',
          'Job Number': '',
          'Job Name': '',
          'Pay Component': 'Hourly',
          Rate: '20',
          'Rate #': '',
          Hours: '40',
          Units: '',
          'Line Date': '',
          Amount: '',
          'Check Seq Number': '1',
          'Override State': '',
          'Override Local': '',
          'Override Local Jurisdiction': '',
          'Labor Override': '',
        },
      ],
      '70205967'
    );
    const lines = csvString.split('\n');
    assert.equal(lines[0], EXPECTED_HEADER);
    assert.equal(
      lines[1],
      '70205967,11,,,,Hourly,20,,40,,,,1,,,,'
    );
  });

  it('validateSpiRows requires Worker ID / Pay Component; Overtime Rate must be blank', () => {
    const errors = validateSpiRows([
      {
        'Worker ID': '11',
        'Pay Component': 'Overtime',
        Rate: '20',
        Hours: '10',
      },
      {
        'Worker ID': '',
        'Pay Component': 'Hourly',
        Hours: '8',
      },
    ]);
    assert.ok(errors.some((e) => /Overtime Rate/i.test(e.reason)));
    assert.ok(errors.some((e) => /Worker ID/i.test(e.reason)));
  });

  it('stripMetadata drops underscore fields only', () => {
    const cleaned = stripMetadata({
      'Worker ID': '11',
      'Pay Component': 'Hourly',
      _employeeName: 'Jane',
      _workerDbId: 'uuid',
      worker_id: '11',
    });
    assert.equal(cleaned['Worker ID'], '11');
    assert.equal(cleaned._employeeName, undefined);
    assert.equal(cleaned.worker_id, undefined);
  });

  it('computeTotalAmount no longer subtracts short pay', () => {
    assert.equal(
      computeTotalAmount({
        hourlyHours: 10,
        hourlyRate: 20,
        reimbursementAmount: 50,
      }),
      250
    );
  });
});

describe('generateSPIRows pay-component rows (integration)', () => {
  let query;
  let pool;
  let workerId;
  let workerBId;
  let employeeCode;
  let employeeCodeB;
  let siteA;
  let siteB;
  let payPeriodId;
  let payPeriodEndDate;
  const createdTimeEntryIds = [];
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
      `SELECT id, name FROM job_sites WHERE is_active = true ORDER BY name LIMIT 2`
    );
    if (sites.rows.length < 2) {
      skip = true;
      return;
    }
    siteA = sites.rows[0];
    siteB = sites.rows[1];

    const period = await query(
      `SELECT id, end_date::text AS end_date
       FROM pay_periods WHERE status = 'OPEN' ORDER BY start_date DESC LIMIT 1`
    );
    if (!period.rows.length) {
      skip = true;
      return;
    }
    payPeriodId = period.rows[0].id;
    payPeriodEndDate = period.rows[0].end_date;

    employeeCode = `SPICMP-${Date.now()}`;
    const workerInsert = await query(
      `INSERT INTO workers (
         employee_code, first_name, last_name, standard_rate, is_active, paychex_worker_id
       ) VALUES ($1, 'Spi', 'ComponentA', $2, true, $3)
       RETURNING id`,
      [employeeCode, STANDARD, `pcx-${employeeCode}`]
    );
    workerId = workerInsert.rows[0].id;

    employeeCodeB = `SPICMPB-${Date.now()}`;
    const workerBInsert = await query(
      `INSERT INTO workers (
         employee_code, first_name, last_name, standard_rate, is_active, paychex_worker_id
       ) VALUES ($1, 'Spi', 'ComponentB', $2, true, $3)
       RETURNING id`,
      [employeeCodeB, STANDARD, `pcx-${employeeCodeB}`]
    );
    workerBId = workerBInsert.rows[0].id;
  });

  after(async () => {
    if (!query) return;
    if (createdOverrideIds.length) {
      await query('DELETE FROM worker_job_site_rates WHERE id = ANY($1::uuid[])', [
        createdOverrideIds,
      ]);
    }
    if (createdTimeEntryIds.length > 0) {
      await query('DELETE FROM time_entries WHERE id = ANY($1::uuid[])', [
        createdTimeEntryIds,
      ]);
    }
    if (workerId) {
      await query('DELETE FROM payroll_adjustments WHERE worker_id = $1', [workerId]);
      await query('DELETE FROM workers WHERE id = $1', [workerId]);
    }
    if (workerBId) {
      await query('DELETE FROM payroll_adjustments WHERE worker_id = $1', [workerBId]);
      await query('DELETE FROM workers WHERE id = $1', [workerBId]);
    }
    if (pool) await pool.end();
  });

  async function seedEntry(wid, siteId, component, hours, reimbursement = 0) {
    const inserted = await query(
      `INSERT INTO time_entries (
         worker_id, job_site_id, pay_period_id, pay_period_end_date,
         paychex_component_id, component_name, hours, reimbursement_amount
       ) VALUES ($1, $2, $3, $4::date, $5, $5, $6::numeric, $7::numeric)
       RETURNING id`,
      [wid, siteId, payPeriodId, payPeriodEndDate, component, hours, reimbursement]
    );
    createdTimeEntryIds.push(inserted.rows[0].id);
  }

  async function clearSeed() {
    if (createdTimeEntryIds.length) {
      await query('DELETE FROM time_entries WHERE id = ANY($1::uuid[])', [
        createdTimeEntryIds,
      ]);
      createdTimeEntryIds.length = 0;
    }
    if (createdOverrideIds.length) {
      await query('DELETE FROM worker_job_site_rates WHERE id = ANY($1::uuid[])', [
        createdOverrideIds,
      ]);
      createdOverrideIds.length = 0;
    }
    await query('DELETE FROM payroll_adjustments WHERE worker_id = ANY($1::uuid[])', [
      [workerId, workerBId].filter(Boolean),
    ]);
  }

  it('Hourly + OT + Reimbursement → 3 rows, shared Check Seq, blanks per rules', async (t) => {
    if (skip) {
      t.skip('DATABASE_URL / fixtures unavailable');
      return;
    }
    await clearSeed();

    await seedEntry(workerId, siteA.id, 'HOURLY', 40, 500);
    await seedEntry(workerId, siteA.id, 'OT', 10);

    const { rows, notFound } = await generateSPIRows(payPeriodId);
    assert.ok(!notFound);

    const workerRows = rows.filter((r) => String(r['Worker ID']) === String(employeeCode));
    assert.equal(workerRows.length, 3);

    const hourly = workerRows.find((r) => r['Pay Component'] === PAY_COMPONENT.HOURLY);
    const ot = workerRows.find((r) => r['Pay Component'] === PAY_COMPONENT.OVERTIME);
    const reimb = workerRows.find((r) => r['Pay Component'] === PAY_COMPONENT.REIMBURSEMENT);

    assert.ok(hourly && ot && reimb);
    assert.equal(hourly.Rate, String(STANDARD));
    assert.equal(hourly.Hours, '40');
    assert.equal(hourly.Amount, '');
    assert.equal(ot.Rate, '');
    assert.equal(ot.Hours, '10');
    assert.equal(ot.Amount, '');
    assert.equal(reimb.Rate, '');
    assert.equal(reimb.Hours, '');
    assert.equal(reimb.Amount, '500');

    const seq = hourly['Check Seq Number'];
    assert.ok(seq);
    assert.equal(ot['Check Seq Number'], seq);
    assert.equal(reimb['Check Seq Number'], seq);

    for (const row of workerRows) {
      assert.equal(row['Company ID'], PAYCHEX_COMPANY_ID || process.env.PAYCHEX_CLIENT_CODE || '70205967');
      assert.equal(row.Org, '');
      assert.equal(row['Job Number'], '');
      assert.equal(row['Job Name'], '');
      assert.equal(row['Rate #'], '');
      assert.equal(row.Units, '');
      assert.equal(row['Line Date'], '');
    }
  });

  it('two effective rates → 2 Hourly rows only, same Check Seq', async (t) => {
    if (skip) {
      t.skip('DATABASE_URL / fixtures unavailable');
      return;
    }
    await clearSeed();

    const override = await query(
      `INSERT INTO worker_job_site_rates (worker_id, job_site_id, rate)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [workerId, siteA.id, OVERRIDE]
    );
    createdOverrideIds.push(override.rows[0].id);

    await seedEntry(workerId, siteA.id, 'HOURLY', 8);
    await seedEntry(workerId, siteB.id, 'HOURLY', 5);

    const { rows } = await generateSPIRows(payPeriodId);
    const workerRows = rows.filter((r) => String(r['Worker ID']) === String(employeeCode));
    assert.equal(workerRows.length, 2);
    assert.ok(workerRows.every((r) => r['Pay Component'] === PAY_COMPONENT.HOURLY));

    const byRate = Object.fromEntries(workerRows.map((r) => [r.Rate, r.Hours]));
    assert.equal(byRate[String(OVERRIDE)], '8');
    assert.equal(byRate[String(STANDARD)], '5');
    assert.equal(workerRows[0]['Check Seq Number'], workerRows[1]['Check Seq Number']);
  });

  it('same effective rate across two job sites → 1 Hourly row with combined hours', async (t) => {
    if (skip) {
      t.skip('DATABASE_URL / fixtures unavailable');
      return;
    }
    await clearSeed();

    await seedEntry(workerId, siteA.id, 'HOURLY', 4);
    await seedEntry(workerId, siteB.id, 'HOURLY', 6);

    const { rows } = await generateSPIRows(payPeriodId);
    const workerRows = rows.filter((r) => String(r['Worker ID']) === String(employeeCode));
    assert.equal(workerRows.length, 1);
    assert.equal(workerRows[0]['Pay Component'], PAY_COMPONENT.HOURLY);
    assert.equal(workerRows[0].Hours, '10');
    assert.equal(workerRows[0].Rate, String(STANDARD));
  });

  it('Check Seq Number increments per worker (1 then 2)', async (t) => {
    if (skip) {
      t.skip('DATABASE_URL / fixtures unavailable');
      return;
    }
    await clearSeed();

    await seedEntry(workerId, siteA.id, 'HOURLY', 8);
    await seedEntry(workerId, siteA.id, 'OT', 2);
    await seedEntry(workerBId, siteA.id, 'HOURLY', 10);

    const { rows } = await generateSPIRows(payPeriodId);
    const aRows = rows.filter((r) => String(r['Worker ID']) === String(employeeCode));
    const bRows = rows.filter((r) => String(r['Worker ID']) === String(employeeCodeB));

    assert.ok(aRows.length >= 2);
    assert.equal(bRows.length, 1);

    const seqA = aRows[0]['Check Seq Number'];
    const seqB = bRows[0]['Check Seq Number'];
    assert.ok(aRows.every((r) => r['Check Seq Number'] === seqA));
    assert.equal(bRows[0]['Check Seq Number'], seqB);
    assert.notEqual(seqA, seqB);

    // ComponentA sorts before ComponentB by last name → seq 1 then 2 among our workers
    // (other period workers may exist; compare relative order within our pair)
    const firstA = rows.findIndex((r) => String(r['Worker ID']) === String(employeeCode));
    const firstB = rows.findIndex((r) => String(r['Worker ID']) === String(employeeCodeB));
    assert.ok(firstA < firstB);
    assert.ok(Number(seqA) < Number(seqB));
  });

  it('zero OT and zero reimbursement → Hourly only', async (t) => {
    if (skip) {
      t.skip('DATABASE_URL / fixtures unavailable');
      return;
    }
    await clearSeed();

    await seedEntry(workerId, siteA.id, 'HOURLY', 10);

    const { rows } = await generateSPIRows(payPeriodId);
    const workerRows = rows.filter((r) => String(r['Worker ID']) === String(employeeCode));
    assert.equal(workerRows.length, 1);
    assert.equal(workerRows[0]['Pay Component'], PAY_COMPONENT.HOURLY);
    assert.equal(workerRows[0].Hours, '10');
  });
});
