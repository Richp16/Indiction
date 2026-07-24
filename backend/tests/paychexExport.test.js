const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  EXPORT_CSV_HEADERS,
  computeTotalAmount,
  displayHourlyHours,
  displayOvertimeHours,
  validateSpiRows,
  generateSPICSV,
  sumRowHours,
  formatHours,
  formatMoney,
} = require('../services/paychexExport');

describe('paychexExport worker×job SPI shape', () => {
  it('exports target column headers in order', () => {
    assert.deepEqual(EXPORT_CSV_HEADERS, [
      'Name',
      'Employee ID',
      'Total Amount',
      'Job',
      'Hourly Hours',
      'Hourly Rate',
      'Overtime Hours',
      'Reimbursement Amount',
      'Short Pay Amount',
    ]);
  });

  it('merges hourly + PTO into display hourly hours and OT + DT into overtime', () => {
    const agg = {
      hourly_hours: 80,
      overtime_hours: 10,
      doubletime_hours: 2,
      pto_hours: 4,
    };
    assert.equal(displayHourlyHours(agg), 84);
    assert.equal(displayOvertimeHours(agg), 12);
  });

  it('computes Total Amount with OT 1.5× and DT 2× (excludes reimbursement)', () => {
    // 80 × 21 + 10 × 21 × 1.5 = 1680 + 315 = 1995
    assert.equal(
      computeTotalAmount({
        hourlyHours: 80,
        overtimeHours: 10,
        hourlyRate: 21,
      }),
      1995
    );
    // John Smith style: 80 × 21 = 1680
    assert.equal(
      computeTotalAmount({
        hourlyHours: 80,
        overtimeHours: 0,
        hourlyRate: 21,
      }),
      1680
    );
    // DT at 2×
    assert.equal(
      computeTotalAmount({
        hourlyHours: 0,
        overtimeHours: 0,
        doubletimeHours: 10,
        hourlyRate: 20,
      }),
      400
    );
  });

  it('formats hours to 1 decimal and money to 2 decimals', () => {
    assert.equal(formatHours(80), '80.0');
    assert.equal(formatHours(10.25), '10.3');
    assert.equal(formatMoney(1680), '1680.00');
  });

  it('sums hourly + overtime for period hour reconciliation', () => {
    const rows = [
      { 'Hourly Hours': '80.0', 'Overtime Hours': '10.0' },
      { 'Hourly Hours': '45.0', 'Overtime Hours': '0.0' },
      { 'Hourly Hours': '0.0', 'Overtime Hours': '10.0' },
    ];
    const total = rows.reduce((sum, row) => sum + sumRowHours(row), 0);
    assert.equal(total, 145);
  });

  it('validates required name and employee id; allows reimbursement-only rows', () => {
    const errors = validateSpiRows([
      {
        Name: 'Jane',
        'Employee ID': '',
        'Hourly Hours': '8.0',
        'Overtime Hours': '0.0',
        'Reimbursement Amount': '0.00',
      },
      {
        Name: 'Bob',
        'Employee ID': '99',
        'Hourly Hours': '0.0',
        'Overtime Hours': '0.0',
        'Reimbursement Amount': '25.00',
      },
    ]);
    assert.ok(errors.some((e) => e.row === 0 && /Employee ID/i.test(e.reason)));
    assert.ok(!errors.some((e) => e.row === 1));
  });

  it('CSV uses the new headers and cell values', () => {
    const { csvString, filename } = generateSPICSV(
      [
        {
          Name: 'Edgar Jose Aguilar Rios',
          'Employee ID': '42',
          'Total Amount': '1995.00',
          Job: 'TXDOT - Bell County',
          'Hourly Hours': '80.0',
          'Hourly Rate': '21.00',
          'Overtime Hours': '10.0',
          'Reimbursement Amount': '0.00',
          'Short Pay Amount': '0.00',
          _workerDbId: 'ignore',
        },
      ],
      'demo'
    );
    assert.equal(filename, 'demo_ta.csv');
    const lines = csvString.split('\n');
    assert.equal(lines[0], EXPORT_CSV_HEADERS.join(','));
    assert.match(lines[1], /Edgar Jose Aguilar Rios/);
    assert.match(lines[1], /TXDOT - Bell County/);
    assert.match(lines[1], /80\.0/);
    assert.match(lines[1], /10\.0/);
    assert.ok(!csvString.includes('Pay Component'));
  });

});
