const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  formatPeriodLabel,
  mapPeriodOption,
  isIsoDate,
} = require('../services/payrollPayPeriods');

describe('payroll pay period helpers', () => {
  it('formats period labels in UTC', () => {
    assert.equal(formatPeriodLabel('2026-06-28', '2026-07-11'), 'Jun 28 – Jul 11, 2026');
  });

  it('validates ISO dates', () => {
    assert.equal(isIsoDate('2026-07-11'), true);
    assert.equal(isIsoDate('07/11/2026'), false);
    assert.equal(isIsoDate(''), false);
  });

  it('maps period options with current flag and dual date keys', () => {
    const option = mapPeriodOption(
      {
        id: 'period-1',
        start_date: '2026-06-28',
        end_date: '2026-07-11',
        status: 'OPEN',
      },
      { isCurrent: true }
    );

    assert.deepEqual(option, {
      id: 'period-1',
      payPeriodId: 'period-1',
      paychexPeriodId: null,
      startDate: '2026-06-28',
      endDate: '2026-07-11',
      start_date: '2026-06-28',
      end_date: '2026-07-11',
      week1Start: '2026-06-28',
      week1End: '2026-07-04',
      week2Start: '2026-07-05',
      week2End: '2026-07-11',
      week1Label: 'Week 1: Jun 28 – Jul 4',
      week2Label: 'Week 2: Jul 5 – Jul 11',
      status: 'OPEN',
      label: 'Jun 28 – Jul 11, 2026',
      isCurrent: true,
    });
  });
});
