/**
 * Unit tests for safe date parsing / label building (no DB required).
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  safeParseDate,
  buildPaychexPeriodLabel,
  mapStoredRow,
} = require('../services/paychexPayPeriodStore');

describe('paychex pay period label guards', () => {
  it('safeParseDate accepts ISO dates and rejects invalid values', () => {
    assert.equal(safeParseDate('2026-06-14')?.toISOString().slice(0, 10), '2026-06-14');
    assert.equal(safeParseDate(null), null);
    assert.equal(safeParseDate(''), null);
    assert.equal(safeParseDate('Invalid Date'), null);
    assert.equal(safeParseDate('not-a-date'), null);
  });

  it('formats a date range when both dates are valid', () => {
    const label = buildPaychexPeriodLabel({
      startDate: '2026-06-14',
      endDate: '2026-06-27',
      description: 'Biweekly',
      checkCount: 37,
      payPeriodId: '1140037241110861',
    });
    assert.equal(label, 'Jun 14 – Jun 27, 2026');
    assert.ok(!/Invalid Date/i.test(label));
    assert.ok(!/\bNaN\b/.test(label));
  });

  it('falls back to description + checkCount when dates are missing', () => {
    const label = buildPaychexPeriodLabel({
      startDate: null,
      endDate: null,
      description: 'Manual Adjustment',
      checkCount: 0,
      payPeriodId: '1140037241110001',
    });
    assert.equal(label, 'Manual Adjustment (0 checks)');
  });

  it('falls back to Pay period (N checks) when description and dates are missing', () => {
    const label = buildPaychexPeriodLabel({
      startDate: 'bogus',
      endDate: 'also-bogus',
      description: null,
      checkCount: 12,
      payPeriodId: '1140037241110002',
    });
    assert.equal(label, 'Pay period (12 checks)');
  });

  it('labels void periods with description only (no date math)', () => {
    const label = buildPaychexPeriodLabel({
      startDate: '2026-01-01',
      endDate: '2026-01-14',
      description: 'Void',
      checkCount: 0,
      payPeriodId: '1140037241110003',
    });
    assert.equal(label, 'Void (0 checks)');
  });

  it('mapStoredRow never emits Invalid Date labels', () => {
    const mapped = mapStoredRow({
      id: 1,
      company_id: '004WOHNWM70Z2EDFHRDY',
      pay_period_id: '1140037241110004',
      interval_code: null,
      status: 'COMPLETED',
      description: 'Void',
      start_date: null,
      end_date: null,
      submit_by_date: null,
      check_date: null,
      check_count: 0,
      created_at: null,
      updated_at: null,
    });

    assert.equal(mapped.label, 'Void (0 checks)');
    assert.equal(mapped.displayLabel, 'Void (0 checks)');
    assert.equal(mapped.hasValidDates, false);
    assert.equal(mapped.week1End, null);
    assert.equal(mapped.week2End, null);
    assert.ok(!/Invalid Date/i.test(mapped.label));
  });

  it('mapStoredRow builds week bounds only from valid dates', () => {
    const mapped = mapStoredRow({
      id: 2,
      company_id: '004WOHNWM70Z2EDFHRDY',
      pay_period_id: '1140037241110861',
      status: 'COMPLETED',
      description: 'Biweekly',
      start_date: '2026-06-14',
      end_date: '2026-06-27',
      check_count: 37,
    });

    assert.equal(mapped.label, 'Jun 14 – Jun 27, 2026');
    assert.equal(mapped.week1Start, '2026-06-14');
    assert.equal(mapped.week1End, '2026-06-20');
    assert.equal(mapped.week2Start, '2026-06-21');
    assert.equal(mapped.week2End, '2026-06-27');
    assert.equal(mapped.hasValidDates, true);
  });
});
