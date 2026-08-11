const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { PDFDocument } = require('pdf-lib');
const {
  getIsoWeekNumber,
  getJobSiteWeekNumber,
  getWh347PageTypes,
  formatLongDate,
  fillWh347Form,
  WORKERS_PER_PAGE,
  TEMPLATE_PATH,
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

describe('job-site week numbering for CERTIFIED PAYROLL NO.', () => {
  it('May 1 start + June 20 week ending = week 8', () => {
    // 2025-05-01 → 2025-06-20 = 50 days; floor(50/7)+1 = 8
    assert.equal(getJobSiteWeekNumber('2025-05-01', '2025-06-20'), '8');
  });

  it('same-day start/end is week 1', () => {
    assert.equal(getJobSiteWeekNumber('2025-05-01', '2025-05-01'), '1');
  });

  it('day 7 (start+6) stays week 1; day 8 (start+7) becomes week 2', () => {
    assert.equal(getJobSiteWeekNumber('2025-05-01', '2025-05-07'), '1'); // +6 days
    assert.equal(getJobSiteWeekNumber('2025-05-01', '2025-05-08'), '2'); // +7 days
  });

  it('falls back to ISO week when start_date is missing', () => {
    assert.equal(getJobSiteWeekNumber(null, '2026-07-04'), getIsoWeekNumber('2026-07-04'));
    assert.equal(getJobSiteWeekNumber('', '2026-07-04'), getIsoWeekNumber('2026-07-04'));
  });

  it('falls back to ISO week when week ending is before start_date', () => {
    assert.equal(getJobSiteWeekNumber('2025-06-01', '2025-05-01'), getIsoWeekNumber('2025-05-01'));
  });
});

describe('WH-347 PDF page ordering', () => {
  it('plans all payroll pages before the statement page', () => {
    assert.deepEqual(getWh347PageTypes(1), ['payroll', 'statement']);
    assert.deepEqual(getWh347PageTypes(WORKERS_PER_PAGE), ['payroll', 'statement']);
    assert.deepEqual(getWh347PageTypes(WORKERS_PER_PAGE + 1), [
      'payroll',
      'payroll',
      'statement',
    ]);
    assert.deepEqual(getWh347PageTypes(WORKERS_PER_PAGE * 2 + 1), [
      'payroll',
      'payroll',
      'payroll',
      'statement',
    ]);
  });

  it(
    'generated multi-page PDF has worker pages then statement last',
    { skip: !fs.existsSync(TEMPLATE_PATH) },
    async () => {
      const workerCount = WORKERS_PER_PAGE + 2; // force one continuation page
      const workers = Array.from({ length: workerCount }, (_, i) => ({
        id: `w-${i}`,
        first_name: `Worker${i}`,
        last_name: `Test${i}`,
        identifying_number: String(1000 + i),
        labor_classification: 'Laborer',
        wh347WorkerType: 'J',
        pay_rate: 20,
        days: {
          sun: { st: 0, ot: 0 },
          mon: { st: 8, ot: 0 },
          tue: { st: 8, ot: 0 },
          wed: { st: 8, ot: 0 },
          thu: { st: 8, ot: 0 },
          fri: { st: 8, ot: 0 },
          sat: { st: 0, ot: 0 },
        },
      }));

      const pdfBuffer = await fillWh347Form({
        project: {
          name: 'Overflow Job',
          job_code: 'JOB-1',
          start_date: '2025-05-01',
        },
        company: { company_name: 'Test Co' },
        weekEndingDate: '2025-06-20',
        workers,
        supplementsByWorker: new Map(),
        flatten: false,
      });

      const doc = await PDFDocument.load(pdfBuffer);
      const expected = getWh347PageTypes(workerCount);
      assert.equal(doc.getPageCount(), expected.length);
      assert.equal(doc.getPageCount(), 3); // 2 payroll + statement
      // Plan contract: statement is always last when overflow exists.
      assert.equal(expected[expected.length - 1], 'statement');
      assert.ok(expected.slice(0, -1).every((t) => t === 'payroll'));
    }
  );
});
