const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  filterClosedPayPeriods,
  parsePaychexDateString,
  buildHistoryDateWindow,
  normalizePayPeriod,
  hasHistoricalPeriods,
  buildPayPeriodsPath,
  CLOSED_PERIODS_LIMIT,
  HISTORY_MONTHS,
} = require('../services/paychexPayPeriods');

describe('certified payroll pay period filtering', () => {
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

  it('parses Paychex date strings as UTC midnight', () => {
    const parsed = parsePaychexDateString('2026-06-27T00:00:00Z');
    assert.equal(parsed.toISOString().slice(0, 10), '2026-06-27');
  });

  it('filters to closed periods only and returns up to 10 most recent', () => {
    const periods = Array.from({ length: 12 }, (_, index) => ({
      payPeriodId: `period-${index}`,
      startDate: isoDate(new Date(Date.UTC(2025, 0, 1 + index * 14))),
      endDate: isoDate(new Date(Date.UTC(2025, 0, 14 + index * 14))),
    }));

    periods.push({
      payPeriodId: 'open-period',
      startDate: isoDate(yesterday),
      endDate: isoDate(tomorrow),
    });

    const recent = filterClosedPayPeriods(periods);

    assert.equal(recent.length, CLOSED_PERIODS_LIMIT);
    assert.ok(recent.every((period) => parsePaychexDateString(period.endDate) < new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
    )));
    assert.equal(recent[0].payPeriodId, 'period-11');
    assert.equal(recent[recent.length - 1].payPeriodId, 'period-2');
    assert.ok(!recent.some((period) => period.payPeriodId === 'open-period'));
  });

  it('builds a six-month history window ending today', () => {
    const window = buildHistoryDateWindow();
    const today = new Date();
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - HISTORY_MONTHS);

    assert.equal(window.endDate, today.toISOString().split('T')[0]);
    assert.equal(window.startDate, sixMonthsAgo.toISOString().split('T')[0]);
  });

  it('normalizes processing period ids and date fields', () => {
    const normalized = normalizePayPeriod({
      processingPeriodId: 'proc-1',
      processingPeriodStartDate: '2026-01-01',
      processingPeriodEndDate: '2026-01-14',
      status: 'PROCESSED',
    });

    assert.deepEqual(normalized, {
      payPeriodId: 'proc-1',
      startDate: '2026-01-01',
      endDate: '2026-01-14',
      status: 'PROCESSED',
      sourceIdField: 'processingPeriodId',
    });
  });

  it('detects historical periods by closed end date or processed status', () => {
    assert.equal(
      hasHistoricalPeriods([
        {
          payPeriodId: 'future',
          startDate: isoDate(tomorrow),
          endDate: isoDate(tomorrow),
          status: 'INITIAL',
        },
      ]),
      false
    );

    assert.equal(
      hasHistoricalPeriods([
        {
          payPeriodId: 'processed',
          startDate: isoDate(twoWeeksAgo),
          endDate: isoDate(tomorrow),
          status: 'PROCESSED',
        },
      ]),
      true
    );
  });

  it('builds pay period paths with date query params', () => {
    process.env.PAYCHEX_COMPANY_ID = 'company-123';
    const path = buildPayPeriodsPath(
      'payperiods',
      { label: 'from/to', startKey: 'from', endKey: 'to' },
      { startDate: '2026-01-10', endDate: '2026-07-10' }
    );

    assert.equal(
      path,
      '/companies/company-123/payperiods?from=2026-01-10&to=2026-07-10'
    );
  });

  it('excludes periods with unparseable end dates', () => {
    const recent = filterClosedPayPeriods([
      {
        payPeriodId: 'bad-date',
        startDate: '2026-01-01',
        endDate: 'not-a-date',
      },
      {
        payPeriodId: 'good-date',
        startDate: isoDate(twoWeeksAgo),
        endDate: isoDate(yesterday),
      },
    ]);

    assert.equal(recent.length, 1);
    assert.equal(recent[0].payPeriodId, 'good-date');
  });
});
