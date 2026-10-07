const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildLocalPayrollCsv,
} = require('../services/localPayroll');
const { buildCapabilities } = require('../middleware/paychexGuard');
const { PAY_CODE_META, STANDARD_DAILY_PAY_CODES } = require('../config/payCodeMapping');

describe('capabilities', () => {
  it('exposes local export and import only when Paychex is off', () => {
    const local = buildCapabilities(false);
    assert.equal(local.supportsLocalPayrollExport, true);
    assert.equal(local.supportsTimeEntryImport, true);
    assert.equal(local.supportsSpiExport, false);
    assert.equal(local.supportsProviderCheckData, false);

    const paychex = buildCapabilities(true);
    assert.equal(paychex.supportsLocalPayrollExport, false);
    assert.equal(paychex.supportsSpiExport, true);
  });
});

describe('pay code meta', () => {
  it('documents multipliers and gross contribution for standard codes', () => {
    assert.equal(PAY_CODE_META.OT.multiplier, 1.5);
    assert.equal(PAY_CODE_META.DT.multiplier, 2);
    assert.equal(PAY_CODE_META.REIMBURSE.contributesToGross, false);
    assert.deepEqual(STANDARD_DAILY_PAY_CODES, Object.keys(PAY_CODE_META));
  });
});

describe('local payroll CSV', () => {
  it('emits stable provider-neutral columns', () => {
    const csv = buildLocalPayrollCsv({
      rows: [
        {
          employeeCode: 'E100',
          firstName: 'Alex',
          lastName: 'Rivera',
          periodStart: '2026-06-28',
          periodEnd: '2026-07-11',
          payDate: '2026-07-18',
          jobCode: 'PW-2024',
          payCode: 'REGULAR',
          hours: 8,
          rate: 40,
          amount: 320,
          reimbursementAmount: 0,
          totalGross: 320,
        },
      ],
      companyTotals: { hours: 8, gross: 320, reimbursements: 0, total: 320 },
    });
    assert.match(csv, /employee_code,first_name,last_name/);
    assert.match(csv, /E100,Alex,Rivera/);
    assert.match(csv, /TOTALS/);
  });
});
