const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  extractPayPeriodFromCheck,
  indexChecksByWorker,
  reconstructPayPeriodsFromChecks,
  buildPeriodShape,
  parsePayPeriodId,
  filterChecksForPayPeriod,
  parseCheckForSupplement,
  parsePaychexDateString,
  todayUtcMidnight,
  CLOSED_PERIODS_LIMIT,
  HISTORY_MONTHS,
  buildHistoryDateWindow,
} = require('../services/paychexCompanyChecks');
const { buildComponentMap, resolveComponentLabel } = require('../services/paychexPayComponents');

describe('certified payroll company checks pipeline', () => {
  const today = new Date();
  const yesterday = new Date(Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate() - 1
  ));
  const twoWeeksAgo = new Date(Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate() - 14
  ));
  const tomorrow = new Date(Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate() + 1
  ));

  function isoDate(date) {
    return date.toISOString().split('T')[0];
  }

  function sampleCheck({ workerId, startDate, endDate, gross = 1000 }) {
    return {
      workerId,
      grossEarnings: gross,
      netPay: gross * 0.8,
      payPeriod: { startDate, endDate },
      taxes: [
        { taxType: 'FEDERAL_INCOME', amount: 100, componentType: 'EMPLOYEE' },
        { taxType: 'SOCIAL_SECURITY', amount: 50, componentType: 'EMPLOYEE' },
        { taxType: 'MEDICARE', amount: 20, componentType: 'EMPLOYEE' },
      ],
      deductions: [{ componentId: 'ded-1', amount: 25 }],
    };
  }

  it('parses Paychex date strings as UTC midnight', () => {
    const parsed = parsePaychexDateString('2026-06-27T00:00:00Z');
    assert.equal(parsed.toISOString().slice(0, 10), '2026-06-27');
  });

  it('builds a six-month history window ending today', () => {
    const window = buildHistoryDateWindow();
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - HISTORY_MONTHS);

    assert.equal(window.endDate, today.toISOString().split('T')[0]);
    assert.equal(window.startDate, sixMonthsAgo.toISOString().split('T')[0]);
  });

  it('extracts pay period dates from check objects', () => {
    const period = extractPayPeriodFromCheck({
      payPeriod: { startDate: '2026-01-01', endDate: '2026-01-14' },
    });
    assert.deepEqual(period, { startDate: '2026-01-01', endDate: '2026-01-14' });
  });

  it('reconstructs closed pay periods from checks and limits to 10', () => {
    const checks = Array.from({ length: 12 }, (_, index) =>
      sampleCheck({
        workerId: `worker-${index}`,
        startDate: isoDate(new Date(Date.UTC(2025, 0, 1 + index * 14))),
        endDate: isoDate(new Date(Date.UTC(2025, 0, 14 + index * 14))),
      })
    );

    checks.push(
      sampleCheck({
        workerId: 'open-worker',
        startDate: isoDate(yesterday),
        endDate: isoDate(tomorrow),
      })
    );

    const periods = reconstructPayPeriodsFromChecks(checks);
    assert.equal(periods.length, CLOSED_PERIODS_LIMIT);
    assert.ok(periods.every((period) => parsePaychexDateString(period.endDate) < todayUtcMidnight()));
    assert.ok(periods[0].endDate >= periods[periods.length - 1].endDate);
  });

  it('builds biweekly period shape with local payPeriodId key', () => {
    const shaped = buildPeriodShape({
      startDate: '2026-01-01',
      endDate: '2026-01-14',
    });

    assert.equal(shaped.payPeriodId, '2026-01-01_2026-01-14');
    assert.equal(shaped.week1Start, '2026-01-01');
    assert.equal(shaped.week1End, '2026-01-07');
    assert.equal(shaped.week2Start, '2026-01-08');
    assert.equal(shaped.week2End, '2026-01-14');
  });

  it('parses payPeriodId keys back into period context', () => {
    const parsed = parsePayPeriodId('2026-01-01_2026-01-14');
    assert.equal(parsed.startDate, '2026-01-01');
    assert.equal(parsed.week2End, '2026-01-14');
  });

  it('indexes checks by worker and keeps highest gross check', () => {
    const checks = [
      sampleCheck({ workerId: 'w1', startDate: '2026-01-01', endDate: '2026-01-14', gross: 900 }),
      sampleCheck({ workerId: 'w1', startDate: '2026-01-01', endDate: '2026-01-14', gross: 1200 }),
      sampleCheck({ workerId: 'w2', startDate: '2026-01-01', endDate: '2026-01-14', gross: 800 }),
    ];

    const indexed = indexChecksByWorker(checks);
    assert.equal(indexed.w1.grossEarnings, 1200);
    assert.equal(indexed.w2.grossEarnings, 800);
  });

  it('filters checks for a selected pay period', () => {
    const checks = [
      sampleCheck({ workerId: 'w1', startDate: '2026-01-01', endDate: '2026-01-14' }),
      sampleCheck({ workerId: 'w2', startDate: '2026-01-15', endDate: '2026-01-28' }),
    ];

    const filtered = filterChecksForPayPeriod(checks, '2026-01-01', '2026-01-14');
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].workerId, 'w1');
  });

  it('parses supplement values from a check', () => {
    const componentMap = buildComponentMap([
      { componentId: 'ded-1', name: 'Health Insurance' },
    ]);
    const parsed = parseCheckForSupplement(
      sampleCheck({
        workerId: 'w1',
        startDate: isoDate(twoWeeksAgo),
        endDate: isoDate(yesterday),
        gross: 1000,
      }),
      componentMap
    );

    assert.equal(parsed.grossPay, 1000);
    assert.equal(parsed.federalWithholding, 100);
    assert.equal(parsed.fica, 70);
    assert.equal(parsed.reimbursementAmount, 0);
    assert.equal(parsed.otherDeductions[0].label, 'Health Insurance');
    assert.equal(parsed.isEstimate, false);
  });

  it('resolves deduction labels from pay component map', () => {
    const map = buildComponentMap([{ componentId: '401k', name: '401k' }]);
    assert.equal(resolveComponentLabel({ componentId: '401k', amount: 10 }, map), '401k');
  });
});
