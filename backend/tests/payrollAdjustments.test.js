/**
 * payroll_adjustments service + SPI money field integration tests.
 */
require('dotenv').config();
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  getAdjustmentsForPeriod,
  upsertAdjustments,
  parseMoney,
} = require('../services/payrollAdjustments');
const {
  resolveMoneyFields,
  computeTotalAmount,
  generateSPIRows,
  generateSPICSV,
  EXPORT_CSV_HEADERS,
} = require('../services/paychexExport');

describe('payrollAdjustments helpers (unit)', () => {
  it('parseMoney rounds to cents', () => {
    assert.equal(parseMoney('12.345'), 12.35);
    assert.equal(parseMoney(null), 0);
  });

  it('resolveMoneyFields adds base reimbursement + adjustment (no short pay)', () => {
    const resolved = resolveMoneyFields({
      base_reimbursement_amount: 40,
      adjustment_reimbursement_amount: 60,
      adjustment_id: 'some-uuid',
    });
    assert.equal(resolved.baseReimbursement, 40);
    assert.equal(resolved.reimbursement, 100);
    assert.equal(resolved.hasAdjustment, true);
  });

  it('computeTotalAmount applies reimbursement without short pay', () => {
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

describe('payrollAdjustments persistence (integration)', () => {
  let query;
  let pool;
  let workerId;
  let employeeCode;
  let siteId;
  let payPeriodId;
  let payPeriodEndDate;
  const createdTimeEntryIds = [];
  let skip = false;
  const RATE = 20;

  before(async () => {
    if (!process.env.DATABASE_URL) {
      skip = true;
      return;
    }
    ({ query, pool } = require('../db'));

    try {
      await query('SELECT 1 FROM payroll_adjustments LIMIT 1');
    } catch {
      skip = true;
      return;
    }

    const sites = await query(
      `SELECT id FROM job_sites WHERE is_active = true ORDER BY name LIMIT 1`
    );
    if (!sites.rows.length) {
      skip = true;
      return;
    }
    siteId = sites.rows[0].id;

    const period = await query(
      `SELECT id, end_date::text AS end_date
       FROM pay_periods WHERE status = 'OPEN'
       ORDER BY start_date DESC LIMIT 1`
    );
    if (!period.rows.length) {
      skip = true;
      return;
    }
    payPeriodId = period.rows[0].id;
    payPeriodEndDate = period.rows[0].end_date;

    employeeCode = `ADJTEST-${Date.now()}`;
    const workerInsert = await query(
      `INSERT INTO workers (
         employee_code, first_name, last_name, standard_rate, is_active, paychex_worker_id
       ) VALUES ($1, 'Adj', 'TestWorker', $2, true, $3)
       RETURNING id`,
      [employeeCode, RATE, `pcx-${employeeCode}`]
    );
    workerId = workerInsert.rows[0].id;
  });

  after(async () => {
    if (!query) return;
    if (workerId && payPeriodId) {
      await query(
        `DELETE FROM payroll_adjustments WHERE pay_period_id = $1 AND worker_id = $2`,
        [payPeriodId, workerId]
      );
    }
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

  it('upserts adjustments and getAdjustmentsForPeriod returns them', async (t) => {
    if (skip) {
      t.skip('DATABASE_URL / payroll_adjustments unavailable');
      return;
    }

    await upsertAdjustments(payPeriodId, [
      { workerId, reimbursementAmount: 25, shortPayAmount: 5 },
    ]);

    let map = await getAdjustmentsForPeriod(payPeriodId);
    assert.ok(map.has(String(workerId)));
    assert.equal(map.get(String(workerId)).reimbursement_amount, 25);
    assert.equal(map.get(String(workerId)).short_pay_amount, 5);

    await upsertAdjustments(payPeriodId, [
      { workerId, reimbursementAmount: 40, shortPayAmount: 10 },
    ]);
    map = await getAdjustmentsForPeriod(payPeriodId);
    assert.equal(map.get(String(workerId)).reimbursement_amount, 40);
    assert.equal(map.get(String(workerId)).short_pay_amount, 10);
  });

  it('SPI emits Hourly + Reimbursement component rows from base + adjustment', async (t) => {
    if (skip) {
      t.skip('DATABASE_URL / payroll_adjustments unavailable');
      return;
    }

    const baseReimb = 30;
    const adjReimb = 70;
    const hourlyHours = 40;

    const inserted = await query(
      `INSERT INTO time_entries (
         worker_id, job_site_id, pay_period_id, pay_period_end_date,
         paychex_component_id, component_name, hours, reimbursement_amount
       ) VALUES ($1, $2, $3, $4::date, 'HOURLY', 'HOURLY', $5::numeric, $6::numeric)
       RETURNING id`,
      [workerId, siteId, payPeriodId, payPeriodEndDate, hourlyHours, baseReimb]
    );
    createdTimeEntryIds.push(inserted.rows[0].id);

    await upsertAdjustments(payPeriodId, [
      { workerId, reimbursementAmount: adjReimb, shortPayAmount: 0 },
    ]);

    const { rows, notFound } = await generateSPIRows(payPeriodId);
    assert.ok(!notFound);

    const workerRows = rows.filter(
      (r) => String(r['Worker ID']) === String(employeeCode)
    );
    assert.equal(workerRows.length, 2);

    const hourly = workerRows.find((r) => r['Pay Component'] === 'Hourly');
    const reimb = workerRows.find((r) => r['Pay Component'] === 'Reimbursement');
    assert.ok(hourly);
    assert.ok(reimb);
    assert.equal(hourly.Hours, String(hourlyHours));
    assert.equal(hourly.Rate, String(RATE));
    assert.equal(reimb.Amount, String(baseReimb + adjReimb));
    assert.equal(hourly['Check Seq Number'], reimb['Check Seq Number']);

    const { csvString } = generateSPICSV(workerRows, '70205967');
    assert.equal(csvString.split('\n')[0], EXPORT_CSV_HEADERS.join(','));
    assert.match(csvString, new RegExp(String(baseReimb + adjReimb)));
    assert.doesNotMatch(csvString, /Short Pay/i);
  });

  it('asAbsolute converts cell totals into reimbursement deltas', async (t) => {
    if (skip) {
      t.skip('DATABASE_URL / payroll_adjustments unavailable');
      return;
    }

    // Cell shows base 30 + prior adj; user sets absolute reimbursement to 50 → delta 20
    await upsertAdjustments(
      payPeriodId,
      [{ workerId, reimbursementAmount: 50, shortPayAmount: 0 }],
      { asAbsolute: true }
    );

    const map = await getAdjustmentsForPeriod(payPeriodId);
    // base from seeded time entry is 30
    assert.equal(map.get(String(workerId)).reimbursement_amount, 20);
  });
});
