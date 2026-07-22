/**
 * Integration tests for paychex_pay_periods persistence.
 * Requires DATABASE_URL and migration 010.
 */
require('dotenv').config();
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { query } = require('../db');
const {
  upsertPaychexPayPeriod,
  requireLocalPayPeriod,
  findLocalPayPeriod,
  listLocalPayPeriods,
  syncCompanyPayPeriods,
} = require('../services/paychexPayPeriodStore');
const paychexHttp = require('../services/paychexHttp');

const TEST_COMPANY = '004WOHNWM70Z2EDFHRDY';
const TEST_PERIOD = '1140037241110861';
const BAD_PERIOD = '1140037269275368';

async function tableExists() {
  try {
    const result = await query(
      `SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'paychex_pay_periods'`
    );
    return result.rows.length > 0;
  } catch {
    return false;
  }
}

describe('paychex_pay_periods store', () => {
  let hasTable = false;
  let originalGet;

  before(async () => {
    hasTable = await tableExists();
    originalGet = paychexHttp.paychexGet;
  });

  after(async () => {
    paychexHttp.paychexGet = originalGet;
    if (hasTable) {
      try {
        await query('DELETE FROM paychex_pay_periods WHERE company_id = $1', [TEST_COMPANY]);
      } catch {
        // ignore cleanup errors
      }
    }
  });

  it('upserts and validates local pay periods', async (t) => {
    if (!hasTable) {
      t.skip('paychex_pay_periods table missing — run npm run migrate:010');
      return;
    }

    const result = await upsertPaychexPayPeriod(TEST_COMPANY, {
      payPeriodId: TEST_PERIOD,
      intervalCode: 'BI_WEEKLY',
      status: 'COMPLETED',
      description: 'Support fixture period',
      startDate: '2026-03-01',
      endDate: '2026-03-14',
      submitByDate: null,
      checkDate: '2026-03-20',
      checkCount: 37,
      raw: { payPeriodId: TEST_PERIOD },
    });
    assert.ok(result === 'inserted' || result === 'updated');

    const again = await upsertPaychexPayPeriod(TEST_COMPANY, {
      payPeriodId: TEST_PERIOD,
      intervalCode: 'BI_WEEKLY',
      status: 'COMPLETED',
      description: 'Support fixture period updated',
      startDate: '2026-03-01',
      endDate: '2026-03-14',
      checkCount: 37,
      raw: { payPeriodId: TEST_PERIOD },
    });
    assert.equal(again, 'updated');

    const found = await findLocalPayPeriod(TEST_COMPANY, TEST_PERIOD);
    assert.equal(found.payPeriodId, TEST_PERIOD);
    assert.equal(found.description, 'Support fixture period updated');

    const required = await requireLocalPayPeriod(TEST_COMPANY, TEST_PERIOD);
    assert.equal(required.payPeriodId, TEST_PERIOD);

    await assert.rejects(
      () => requireLocalPayPeriod(TEST_COMPANY, BAD_PERIOD),
      (err) => {
        assert.equal(err.statusCode, 404);
        assert.match(err.message, /Unknown payPeriodId/);
        return true;
      }
    );

    const listed = await listLocalPayPeriods(TEST_COMPANY, { status: 'COMPLETED' });
    assert.ok(listed.some((row) => row.payPeriodId === TEST_PERIOD));
  });

  it('syncCompanyPayPeriods upserts from mocked Paychex response', async (t) => {
    if (!hasTable) {
      t.skip('paychex_pay_periods table missing — run npm run migrate:010');
      return;
    }

    paychexHttp.paychexGet = async () => [
      {
        payPeriodId: TEST_PERIOD,
        status: 'COMPLETED',
        description: 'Synced via test',
        startDate: '2026-03-01',
        endDate: '2026-03-14',
        checkCount: 37,
      },
      {
        payPeriodId: '1140037241110999',
        status: 'COMPLETED',
        startDate: '2026-03-15',
        endDate: '2026-03-28',
        checkCount: 10,
      },
    ];

    const summary = await syncCompanyPayPeriods({
      companyId: TEST_COMPANY,
      from: '2026-01-01T00:00:00Z',
      to: '2026-12-31T00:00:00Z',
      statuses: ['COMPLETED'],
    });

    assert.equal(summary.fetchedCount, 2);
    assert.ok(summary.insertedCount + summary.updatedCount === 2);
    assert.equal(summary.companyId, TEST_COMPANY);
    assert.equal(summary.from, '2026-01-01T00:00:00Z');
    assert.equal(summary.to, '2026-12-31T23:59:59Z');
  });

  it('historical sync uses normalized UTC full-day ranges and succeeds', async (t) => {
    if (!hasTable) {
      t.skip('paychex_pay_periods table missing — run npm run migrate:010');
      return;
    }

    const { buildPaychexDateRange } = require('../services/paychexPayPeriodApi');
    const { syncHistoricalPaychexPayPeriods } = require('../services/paychexSync');
    const expected = buildPaychexDateRange();
    let capturedPath = '';

    paychexHttp.paychexGet = async (path) => {
      capturedPath = path;
      assert.ok(path.includes('/payperiods?'), 'must call company payperiods');
      assert.ok(path.includes('status=COMPLETED'), 'historical sync uses COMPLETED');
      assert.ok(!path.includes('status=OPEN'), 'historical sync must not use OPEN');
      assert.ok(
        path.includes(`from=${encodeURIComponent(expected.from)}`),
        `from must be ${expected.from}`
      );
      assert.ok(
        path.includes(`to=${encodeURIComponent(expected.to)}`),
        `to must be ${expected.to}`
      );
      assert.ok(!/\.\d{3}Z/.test(path), 'must not send millisecond timestamps');
      assert.match(expected.from, /^\d{4}-\d{2}-\d{2}T00:00:00Z$/);
      assert.match(expected.to, /^\d{4}-\d{2}-\d{2}T23:59:59Z$/);

      return [
        {
          payPeriodId: TEST_PERIOD,
          status: 'COMPLETED',
          description: 'Historical default-range sync',
          startDate: '2026-06-14',
          endDate: '2026-06-27',
          checkCount: 37,
        },
      ];
    };

    // Default-range store sync (same bounds as startup historical sync).
    const storeSummary = await syncCompanyPayPeriods({ companyId: TEST_COMPANY });
    assert.equal(storeSummary.from, expected.from);
    assert.equal(storeSummary.to, expected.to);
    assert.equal(storeSummary.fetchedCount, 1);
    assert.ok(capturedPath.includes('/payperiods?'));

    // Full-sync entry point used on startup.
    const histResult = await syncHistoricalPaychexPayPeriods();
    assert.equal(histResult.status, 'SUCCESS');
    assert.equal(histResult.syncType, 'paychex_pay_periods');
    assert.ok(histResult.summary.fetchedCount >= 1);

    const listed = await listLocalPayPeriods(TEST_COMPANY);
    assert.ok(
      listed.every((row) => row.companyId === TEST_COMPANY),
      'picker source is paychex_pay_periods for this company only'
    );
    assert.ok(listed.some((row) => row.payPeriodId === TEST_PERIOD));
  });
});
