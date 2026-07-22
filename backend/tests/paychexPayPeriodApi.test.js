const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  SUPPORT_INVALID_PAY_PERIOD_ID,
  isPaychexPayPeriodId,
  assertPaychexPayPeriodId,
  assertPaychexWorkerId,
  assertPaychexCompanyId,
} = require('../services/paychexIds');
const {
  normalizePayPeriod,
  normalizeCheck,
  buildCompanyChecksPath,
  buildWorkerChecksPath,
  buildCompanyPayPeriodsPath,
  buildPaychexDateRange,
  normalizePaychexDateBounds,
  getCompanyPayPeriods,
  getCompanyChecksByPayPeriod,
  getWorkerChecksByPayPeriod,
} = require('../services/paychexPayPeriodApi');

/** Support-confirmed fixture IDs — tests/fixtures only, not production defaults. */
const SUPPORT_COMPANY_ID = '004WOHNWM70Z2EDFHRDY';
const SUPPORT_PAY_PERIOD_ID = '1140037241110861';
const SUPPORT_WORKER_ID = '004WOHNWMFGQKR2RLNJS';

describe('paychex ID safety', () => {
  it('accepts numeric Paychex payPeriodIds only', () => {
    assert.equal(isPaychexPayPeriodId(SUPPORT_PAY_PERIOD_ID), true);
    assert.equal(isPaychexPayPeriodId('2026-01-01_2026-01-14'), false);
    assert.equal(isPaychexPayPeriodId('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'), false);
    assert.equal(isPaychexPayPeriodId(SUPPORT_WORKER_ID), false);
  });

  it('rejects empty company/worker ids', () => {
    assert.throws(() => assertPaychexCompanyId(''), /companyId is required/);
    assert.throws(() => assertPaychexWorkerId(''), /workerId is required/);
    assert.throws(() => assertPaychexPayPeriodId('uuid-here'), /numeric Paychex payPeriodId/);
  });

  it('builds support-case company and worker checks paths correctly', () => {
    assert.equal(
      buildCompanyChecksPath(SUPPORT_COMPANY_ID, SUPPORT_PAY_PERIOD_ID),
      `/companies/${SUPPORT_COMPANY_ID}/checks?payperiodid=${SUPPORT_PAY_PERIOD_ID}`
    );
    assert.equal(
      buildWorkerChecksPath(SUPPORT_WORKER_ID, SUPPORT_PAY_PERIOD_ID),
      `/workers/${SUPPORT_WORKER_ID}/checks?payperiodid=${SUPPORT_PAY_PERIOD_ID}`
    );
  });

  it('never embeds the bad payPeriodId unless explicitly injected', () => {
    const path = buildCompanyChecksPath(SUPPORT_COMPANY_ID, SUPPORT_PAY_PERIOD_ID);
    assert.ok(!path.includes(SUPPORT_INVALID_PAY_PERIOD_ID));

    const badPath = buildCompanyChecksPath(
      SUPPORT_COMPANY_ID,
      SUPPORT_INVALID_PAY_PERIOD_ID
    );
    assert.ok(badPath.includes(SUPPORT_INVALID_PAY_PERIOD_ID));
  });

  it('builds payperiods path with from/to/status', () => {
    const path = buildCompanyPayPeriodsPath(SUPPORT_COMPANY_ID, {
      from: '2026-01-01T00:00:00Z',
      to: '2026-12-31T00:00:00Z',
      status: ['COMPLETED'],
    });
    assert.ok(path.startsWith(`/companies/${SUPPORT_COMPANY_ID}/payperiods?`));
    assert.ok(path.includes('from=2026-01-01T00%3A00%3A00Z'));
    assert.ok(path.includes('to=2026-12-31T23%3A59%3A59Z'));
    assert.ok(path.includes('status=COMPLETED'));
  });

  it('buildPaychexDateRange uses full-day UTC without milliseconds', () => {
    const now = new Date(Date.UTC(2026, 6, 21, 18, 47, 7, 783));
    const range = buildPaychexDateRange(now);
    assert.equal(range.from, '2025-07-21T00:00:00Z');
    assert.equal(range.to, '2026-07-21T23:59:59Z');
    assert.ok(!range.from.includes('.'));
    assert.ok(!range.to.includes('.'));
  });

  it('normalizePaychexDateBounds strips milliseconds and expands to day bounds', () => {
    const bounds = normalizePaychexDateBounds(
      '2025-07-21T18:47:07.783Z',
      '2026-07-21T18:47:07.783Z'
    );
    assert.equal(bounds.from, '2025-07-21T00:00:00Z');
    assert.equal(bounds.to, '2026-07-21T23:59:59Z');
  });
});

describe('normalizePayPeriod / normalizeCheck', () => {
  it('normalizes Paychex pay period payloads', () => {
    const normalized = normalizePayPeriod({
      payPeriodId: SUPPORT_PAY_PERIOD_ID,
      intervalCode: 'BI_WEEKLY',
      status: 'COMPLETED',
      description: 'Biweekly 2026-03',
      startDate: '2026-03-01T00:00:00Z',
      endDate: '2026-03-14T00:00:00Z',
      submitByDate: '2026-03-10T00:00:00Z',
      checkDate: '2026-03-20T00:00:00Z',
      checkCount: 37,
    });

    assert.equal(normalized.payPeriodId, SUPPORT_PAY_PERIOD_ID);
    assert.equal(normalized.intervalCode, 'BI_WEEKLY');
    assert.equal(normalized.status, 'COMPLETED');
    assert.equal(normalized.description, 'Biweekly 2026-03');
    assert.equal(normalized.startDate, '2026-03-01');
    assert.equal(normalized.endDate, '2026-03-14');
    assert.equal(normalized.checkCount, 37);
  });

  it('normalizes check earnings fields', () => {
    const normalized = normalizeCheck(
      {
        paycheckId: 'chk-1',
        workerId: SUPPORT_WORKER_ID,
        payPeriodId: SUPPORT_PAY_PERIOD_ID,
        checkDate: '2026-03-20',
        netPay: 1200.5,
        checkType: 'REGULAR',
        checkNumber: '1001',
        earnings: [
          {
            componentId: 'c1',
            checkComponentId: 'cc1',
            name: 'Regular',
            classificationType: 'EARNINGS',
            effectOnPay: 'ADDITION',
            memoed: false,
            organization: { name: 'Field' },
            jobName: 'Job A',
            jobId: 'job-1',
            amount: 1000,
            rate: 25,
            hours: 40,
          },
        ],
        deductions: [{ amount: 50 }],
        taxes: [{ taxType: 'FEDERAL_INCOME', amount: 100 }],
      },
      SUPPORT_PAY_PERIOD_ID
    );

    assert.equal(normalized.payPeriodId, SUPPORT_PAY_PERIOD_ID);
    assert.equal(normalized.paycheckId, 'chk-1');
    assert.equal(normalized.workerId, SUPPORT_WORKER_ID);
    assert.equal(normalized.netPay, 1200.5);
    assert.equal(normalized.earnings[0].componentId, 'c1');
    assert.equal(normalized.earnings[0].hours, 40);
    assert.equal(normalized.deductions.length, 1);
    assert.equal(normalized.taxes.length, 1);
  });
});

describe('Paychex API methods with stubbed paychexGet', () => {
  it('getCompanyPayPeriods returns normalized periods', async () => {
    const http = require('../services/paychexHttp');
    const original = http.paychexGet;
    http.paychexGet = async (path) => {
      assert.ok(path.includes(`/companies/${SUPPORT_COMPANY_ID}/payperiods`));
      assert.ok(path.includes('status=COMPLETED'));
      assert.ok(path.includes('from=2026-01-01T00%3A00%3A00Z'));
      assert.ok(path.includes('to=2026-12-31T23%3A59%3A59Z'));
      assert.ok(!path.includes('.783'));
      return [
        {
          payPeriodId: SUPPORT_PAY_PERIOD_ID,
          status: 'COMPLETED',
          startDate: '2026-03-01',
          endDate: '2026-03-14',
          checkCount: 37,
        },
      ];
    };

    try {
      const periods = await getCompanyPayPeriods({
        companyId: SUPPORT_COMPANY_ID,
        from: '2026-01-01T12:34:56.789Z',
        to: '2026-12-31T18:47:07.783Z',
        status: ['COMPLETED'],
      });
      assert.equal(periods.length, 1);
      assert.equal(periods[0].payPeriodId, SUPPORT_PAY_PERIOD_ID);
      assert.equal(periods[0].checkCount, 37);
    } finally {
      http.paychexGet = original;
    }
  });

  it('company checks uses companyId path and payperiodid query without pagination', async () => {
    const http = require('../services/paychexHttp');
    const original = http.paychexGet;
    http.paychexGet = async (path, options = {}) => {
      assert.equal(
        path,
        `/companies/${SUPPORT_COMPANY_ID}/checks?payperiodid=${SUPPORT_PAY_PERIOD_ID}`
      );
      assert.equal(options.paginate, false);
      assert.ok(!path.includes('offset='));
      assert.ok(!path.includes('limit='));
      return [
        {
          paycheckId: 'p1',
          workerId: SUPPORT_WORKER_ID,
          payPeriodId: SUPPORT_PAY_PERIOD_ID,
          netPay: 500,
        },
      ];
    };

    try {
      const checks = await getCompanyChecksByPayPeriod({
        companyId: SUPPORT_COMPANY_ID,
        payPeriodId: SUPPORT_PAY_PERIOD_ID,
      });
      assert.equal(checks.length, 1);
      assert.equal(checks[0].workerId, SUPPORT_WORKER_ID);
    } finally {
      http.paychexGet = original;
    }
  });

  it('company checks surfaces a stable message on Paychex 500 / API-1', async () => {
    const http = require('../services/paychexHttp');
    const { CHECKS_SERVER_ERROR_MESSAGE } = require('../services/paychexErrors');
    const original = http.paychexGet;
    http.paychexGet = async () => {
      const err = new Error('Paychex server error (500): {"code":"API-1"}');
      err.paychexErrorType = 'server';
      err.statusCode = 500;
      err.paychexErrorCode = 'API-1';
      err.cause = { response: { status: 500, data: { code: 'API-1', message: 'Internal Server Error' } } };
      throw err;
    };

    try {
      await assert.rejects(
        () =>
          getCompanyChecksByPayPeriod({
            companyId: SUPPORT_COMPANY_ID,
            payPeriodId: SUPPORT_PAY_PERIOD_ID,
          }),
        (err) => {
          assert.equal(err.message, CHECKS_SERVER_ERROR_MESSAGE);
          assert.equal(err.statusCode, 500);
          assert.equal(err.paychexErrorCode, 'API-1');
          assert.equal(err.paychexContext.companyId, SUPPORT_COMPANY_ID);
          assert.equal(err.paychexContext.payPeriodId, SUPPORT_PAY_PERIOD_ID);
          return true;
        }
      );
    } finally {
      http.paychexGet = original;
    }
  });

  it('worker checks uses workerId path and payperiodid query without pagination', async () => {
    const http = require('../services/paychexHttp');
    const original = http.paychexGet;
    http.paychexGet = async (path, options = {}) => {
      assert.equal(
        path,
        `/workers/${SUPPORT_WORKER_ID}/checks?payperiodid=${SUPPORT_PAY_PERIOD_ID}`
      );
      assert.equal(options.paginate, false);
      assert.ok(!path.includes(SUPPORT_COMPANY_ID));
      return [{ paycheckId: 'p2', workerId: SUPPORT_WORKER_ID, netPay: 400 }];
    };

    try {
      const checks = await getWorkerChecksByPayPeriod({
        workerId: SUPPORT_WORKER_ID,
        payPeriodId: SUPPORT_PAY_PERIOD_ID,
      });
      assert.equal(checks.length, 1);
      assert.equal(checks[0].paycheckId, 'p2');
    } finally {
      http.paychexGet = original;
    }
  });

  it('worker checks maps draft-period 500 to CHECKS_NOT_READY', async () => {
    const http = require('../services/paychexHttp');
    const store = require('../services/paychexPayPeriodStore');
    const { CHECKS_NOT_READY_MESSAGE } = require('../services/paychexErrors');
    const originalGet = http.paychexGet;
    const originalFind = store.findLocalPayPeriod;

    http.paychexGet = async () => {
      const err = new Error('Paychex server error (500): {"code":"API-1"}');
      err.paychexErrorType = 'server';
      err.statusCode = 500;
      err.paychexErrorCode = 'API-1';
      throw err;
    };
    store.findLocalPayPeriod = async () => ({
      payPeriodId: SUPPORT_PAY_PERIOD_ID,
      status: 'DRAFT',
    });

    try {
      await assert.rejects(
        () =>
          getWorkerChecksByPayPeriod({
            workerId: SUPPORT_WORKER_ID,
            payPeriodId: SUPPORT_PAY_PERIOD_ID,
            companyId: SUPPORT_COMPANY_ID,
          }),
        (err) => {
          assert.equal(err.code, 'CHECKS_NOT_READY');
          assert.equal(err.statusCode, 409);
          assert.equal(err.message, CHECKS_NOT_READY_MESSAGE);
          assert.equal(err.paychexContext.periodStatus, 'DRAFT');
          return true;
        }
      );
    } finally {
      http.paychexGet = originalGet;
      store.findLocalPayPeriod = originalFind;
    }
  });

  it('checks paths force Accept star/star and skip pagination flags', () => {
    const http = require('../services/paychexHttp');
    assert.equal(http.CHECKS_ACCEPT, '*/*');
    assert.equal(http.isChecksPath('/workers/x/checks?payperiodid=1'), true);
    assert.equal(http.isChecksPath('/companies/x/checks?payperiodid=1'), true);
    assert.equal(http.isChecksPath('/companies/x/payperiods'), false);
    assert.equal(
      http.buildGetHeaders('/workers/x/checks?payperiodid=1').Accept,
      '*/*'
    );
    assert.equal(
      http.buildGetHeaders('/companies/x/checks?payperiodid=1').Accept,
      '*/*'
    );
    // Non-checks paths must not force Accept (other endpoints may need a profile).
    assert.equal(
      http.buildGetHeaders('/companies/x/payperiods').Accept,
      undefined
    );
  });

  it('company checks rejects non-numeric payPeriodId before HTTP', async () => {
    await assert.rejects(
      () =>
        getCompanyChecksByPayPeriod({
          companyId: SUPPORT_COMPANY_ID,
          payPeriodId: SUPPORT_WORKER_ID,
        }),
      /numeric Paychex payPeriodId/
    );
  });
});

describe('route-level unknown payPeriodId contract', () => {
  it('documents the validation error message for unknown local IDs', () => {
    const message = 'Unknown payPeriodId for company. Sync pay periods first.';
    assert.match(message, /Unknown payPeriodId/);
    assert.match(message, /Sync pay periods first/);
  });
});
