const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  computeBiweeklyWeekBounds,
  datesOverlap,
  isIsoDate,
} = require('../services/payrollPayPeriods');
const { STANDARD_DAILY_PAY_CODES } = require('../config/payCodeMapping');
const { parseEntriesWorkbook } = require('../services/entriesImportParser');
const XLSX = require('xlsx');

describe('manual pay period helpers', () => {
  it('computes biweekly week bounds', () => {
    const bounds = computeBiweeklyWeekBounds('2026-06-28', '2026-07-11');
    assert.deepEqual(bounds, {
      week1Start: '2026-06-28',
      week1End: '2026-07-04',
      week2Start: '2026-07-05',
      week2End: '2026-07-11',
    });
  });

  it('detects overlapping date ranges', () => {
    assert.equal(datesOverlap('2026-06-28', '2026-07-11', '2026-07-01', '2026-07-15'), true);
    assert.equal(datesOverlap('2026-06-28', '2026-07-11', '2026-07-12', '2026-07-25'), false);
  });

  it('exports standard daily pay codes for Non-Paychex', () => {
    assert.deepEqual(STANDARD_DAILY_PAY_CODES, ['REGULAR', 'OT', 'DT', 'PTO', 'REIMBURSE']);
  });
});

describe('entries import parser', () => {
  it('parses template-style workbook rows', () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ['date_worked', 'employee_code', 'worker_name', 'job_code', 'pay_code', 'hours'],
      ['2026-07-07', 'E100', 'Rivera, Alex', 'PW-2024', 'REGULAR', 8],
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'TimeEntries');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    const parsed = parseEntriesWorkbook(buffer);
    assert.equal(parsed.rowCount, 1);
    assert.equal(parsed.rows[0].employeeCode, 'E100');
    assert.equal(parsed.rows[0].payCode, 'REGULAR');
    assert.equal(parsed.errors.length, 0);
  });

  it('rejects invalid pay codes', () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ['date_worked', 'worker', 'job_site', 'pay_code', 'hours'],
      ['2026-07-07', 'Rivera, Alex', 'PW-2024', 'HOURLY', 8],
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'TimeEntries');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    const parsed = parseEntriesWorkbook(buffer);
    assert.equal(parsed.errors.length, 1);
    assert.match(parsed.errors[0].reasons.join(' '), /invalid pay_code/i);
  });

  it('validates ISO dates', () => {
    assert.equal(isIsoDate('2026-07-07'), true);
    assert.equal(isIsoDate('07/07/2026'), false);
  });
});
