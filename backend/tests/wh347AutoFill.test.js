const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  getIsoWeekNumber,
  formatLongDate,
} = require('../services/wh347FormFill');
const { wh347FieldMap } = require('../config/wh347FieldMap');

describe('WH-347 header auto-fill helpers', () => {
  it('getIsoWeekNumber returns ISO week for week ending 2026-07-04 as 27', () => {
    assert.equal(getIsoWeekNumber('2026-07-04'), '27');
  });

  it('getIsoWeekNumber returns empty string for invalid dates', () => {
    assert.equal(getIsoWeekNumber(''), '');
    assert.equal(getIsoWeekNumber(null), '');
    assert.equal(getIsoWeekNumber('not-a-date'), '');
  });

  it('formatLongDate renders zero-padded MM/DD/YYYY', () => {
    assert.equal(formatLongDate('2026-07-11'), '07/11/2026');
    assert.equal(formatLongDate('2026-01-05'), '01/05/2026');
  });

  it('statement checkBoxes are one field per row in visual top-to-bottom order', () => {
    const boxes = wh347FieldMap.statementPage.checkBoxes;
    assert.equal(boxes.length, 6);
    assert.deepEqual(boxes, [
      'Check Box1', // stmt 1
      'Check Box3', // stmt 2
      'Check Box4', // stmt 3 classifications
      'Check Box2', // stmt 4 apprentices
      'Check Box5', // stmt 5 fringe
      'Check Box6', // stmt 6
    ]);
    // Indexes 1,2,3,6 → fields Check Box1,3,4,6; apprentices (index 4) stays off
    assert.equal(boxes[3], 'Check Box2');
    assert.equal(boxes[2], 'Check Box4');
  });
});
