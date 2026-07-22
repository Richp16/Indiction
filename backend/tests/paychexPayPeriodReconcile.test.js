/**
 * Integration tests for linking pay_periods ↔ paychex_pay_periods.
 */
require('dotenv').config();
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { query, pool } = require('../db');
const {
  pickCatalogMatch,
  enrichPeriodOptionsWithPaychexIds,
  reconcileLocalPayPeriodsToPaychex,
} = require('../services/paychexPayPeriodReconcile');

const TEST_COMPANY = '004WOHNWM70Z2EDFHRDY';
const TEST_PAYCHEX_ID = `9991140037241${String(Date.now()).slice(-4)}`;
const TEMP_LOCAL_PAYCHEX_ID = `temp-reconcile-${Date.now()}`;

async function tablesReady() {
  try {
    const result = await query(
      `SELECT
         EXISTS (
           SELECT 1 FROM information_schema.tables
           WHERE table_name = 'paychex_pay_periods'
         ) AS has_catalog,
         EXISTS (
           SELECT 1 FROM information_schema.tables
           WHERE table_name = 'pay_periods'
         ) AS has_local`
    );
    return Boolean(result.rows[0]?.has_catalog && result.rows[0]?.has_local);
  } catch {
    return false;
  }
}

describe('paychex pay period reconcile', () => {
  let ready = false;
  let localPeriodId = null;

  before(async () => {
    ready = await tablesReady();
    if (!ready) return;

    await query(
      `INSERT INTO paychex_pay_periods (
         company_id, pay_period_id, status, description,
         start_date, end_date, check_count, raw_json
       ) VALUES ($1, $2, 'COMPLETED', 'Reconcile fixture', $3::date, $4::date, 37, '{}'::jsonb)
       ON CONFLICT (company_id, pay_period_id) DO UPDATE SET
         status = EXCLUDED.status,
         start_date = EXCLUDED.start_date,
         end_date = EXCLUDED.end_date,
         updated_at = now()`,
      [TEST_COMPANY, TEST_PAYCHEX_ID, '2099-01-01', '2099-01-14']
    );

    const inserted = await query(
      `INSERT INTO pay_periods (
         paychex_period_id, start_date, end_date, submit_by_date, pay_date, status,
         week1_start, week1_end, week2_start, week2_end
       ) VALUES (
         $1, '2099-01-01', '2099-01-14', '2099-01-12', '2099-01-20', 'CLOSED',
         '2099-01-01', '2099-01-07', '2099-01-08', '2099-01-14'
       )
       RETURNING id::text AS id`,
      [TEMP_LOCAL_PAYCHEX_ID]
    );
    localPeriodId = inserted.rows[0].id;
  });

  after(async () => {
    if (!ready) return;
    try {
      if (localPeriodId) {
        await query('DELETE FROM pay_periods WHERE id = $1::uuid', [localPeriodId]);
      }
      await query(
        `DELETE FROM paychex_pay_periods
         WHERE company_id = $1 AND pay_period_id = $2`,
        [TEST_COMPANY, TEST_PAYCHEX_ID]
      );
      // Repair accidental prior-test collisions on the known support period id.
      await query(
        `DELETE FROM pay_periods WHERE paychex_period_id LIKE '9991140037241%'`
      );
    } catch {
      // ignore cleanup errors
    }
  });

  it('pickCatalogMatch prefers exact end_date COMPLETED rows', () => {
    const match = pickCatalogMatch('2099-01-14', [
      {
        pay_period_id: 'other',
        status: 'COMPLETED',
        end_date: '2099-01-13',
      },
      {
        pay_period_id: TEST_PAYCHEX_ID,
        status: 'COMPLETED',
        end_date: '2099-01-14',
      },
    ]);
    assert.equal(match.pay_period_id, TEST_PAYCHEX_ID);
  });

  it('enrichPeriodOptionsWithPaychexIds sets paychexPayPeriodId from catalog', () => {
    const enriched = enrichPeriodOptionsWithPaychexIds(
      [
        {
          id: 'local-1',
          payPeriodId: 'local-1',
          label: 'Jan 1 – Jan 14, 2099',
          endDate: '2099-01-14',
          paychexPeriodId: 'stale-id',
        },
      ],
      [
        {
          pay_period_id: TEST_PAYCHEX_ID,
          status: 'COMPLETED',
          end_date: '2099-01-14',
        },
      ]
    );

    assert.equal(enriched[0].paychexPayPeriodId, TEST_PAYCHEX_ID);
    assert.equal(enriched[0].paychexPeriodId, TEST_PAYCHEX_ID);
    assert.equal(enriched[0].displayLabel, 'Jan 1 – Jan 14, 2099');
  });

  it('reconcileLocalPayPeriodsToPaychex updates matching local pay period', async (t) => {
    if (!ready) {
      t.skip('pay_periods / paychex_pay_periods tables missing');
      return;
    }

    const summary = await reconcileLocalPayPeriodsToPaychex({ companyId: TEST_COMPANY });
    assert.ok(summary.matched >= 1);
    assert.ok(summary.updated + summary.alreadyLinked >= 1);

    const row = await query(
      `SELECT paychex_period_id FROM pay_periods WHERE id = $1::uuid`,
      [localPeriodId]
    );
    assert.equal(row.rows[0].paychex_period_id, TEST_PAYCHEX_ID);
  });
});
