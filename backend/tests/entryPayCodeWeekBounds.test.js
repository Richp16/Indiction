const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

describe('getWeekBounds (Sunday–Saturday workweek)', () => {
  let getWeekBounds;

  beforeEach(() => {
    delete require.cache[require.resolve('../services/entryPayCode')];
    ({ getWeekBounds } = require('../services/entryPayCode'));
  });

  it('resolves a Wednesday to the enclosing Sunday–Saturday range', () => {
    // 2026-07-22 is a Wednesday → week Sun 2026-07-19 … Sat 2026-07-25
    assert.deepEqual(getWeekBounds('2026-07-22'), {
      sunday: '2026-07-19',
      saturday: '2026-07-25',
    });
  });

  it('keeps Sunday as the start of its own week', () => {
    assert.deepEqual(getWeekBounds('2026-07-19'), {
      sunday: '2026-07-19',
      saturday: '2026-07-25',
    });
  });

  it('keeps Saturday as the end of its own week', () => {
    assert.deepEqual(getWeekBounds('2026-07-25'), {
      sunday: '2026-07-19',
      saturday: '2026-07-25',
    });
  });
});

describe('getWorkerWeeklyHours includes weekend hours toward OT', () => {
  let getWorkerWeeklyHours;
  let getWeekBounds;
  let db;
  let originalQuery;

  beforeEach(() => {
    db = require('../db');
    originalQuery = db.query;
  });

  afterEach(() => {
    db.query = originalQuery;
    delete require.cache[require.resolve('../services/entryPayCode')];
  });

  it('queries Sunday–Saturday and returns weekend hours in the weekly total', async () => {
    const captured = [];
    db.query = async (sql, params) => {
      captured.push({ sql, params });
      // Simulate Mon–Fri 32h + Sat 6h + Sun 4h = 42h (over 40 → OT threshold crossed)
      return { rows: [{ total_hours: '42' }] };
    };

    delete require.cache[require.resolve('../services/entryPayCode')];
    ({ getWorkerWeeklyHours, getWeekBounds } = require('../services/entryPayCode'));

    const entryDate = '2026-07-22'; // Wednesday
    const { sunday, saturday } = getWeekBounds(entryDate);
    const total = await getWorkerWeeklyHours('worker-1', entryDate, 'period-1');

    assert.equal(sunday, '2026-07-19');
    assert.equal(saturday, '2026-07-25');
    assert.equal(captured.length, 1);
    assert.deepEqual(captured[0].params, ['worker-1', 'period-1', sunday, saturday]);
    assert.equal(total, 42);
    assert.ok(total > 40, 'weekend hours should push weekly total over the 40-hour OT cap');
  });

  it('passes Saturday and Sunday dates inside the bound range used for the query', async () => {
    let rangeStart;
    let rangeEnd;
    db.query = async (_sql, params) => {
      [, , rangeStart, rangeEnd] = params;
      return { rows: [{ total_hours: '10' }] };
    };

    delete require.cache[require.resolve('../services/entryPayCode')];
    ({ getWorkerWeeklyHours } = require('../services/entryPayCode'));

    await getWorkerWeeklyHours('worker-1', '2026-07-22', 'period-1');

    assert.equal(rangeStart, '2026-07-19');
    assert.equal(rangeEnd, '2026-07-25');
  });
});
