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

  it('statement required checkboxes are the visual top 3 cert items + last above remarks', () => {
    const boxes = wh347FieldMap.statementPage.checkBoxes;
    assert.deepEqual(boxes, [
      'Check Box1',
      'Check Box2',
      'Check Box3',
      'Check Box4',
      'Check Box5',
      'Check Box6',
    ]);
    // Required by visual Y order (not array index): 1, 3, 4, 6
    const required = new Set(['Check Box1', 'Check Box3', 'Check Box4', 'Check Box6']);
    assert.ok(required.has('Check Box4'), 'classifications = Check Box4');
    assert.ok(!required.has('Check Box2'), 'apprentices = Check Box2 must stay unchecked');
  });
});
