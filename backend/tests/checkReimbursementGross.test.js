/**
 * Reimbursement exclusion from taxable gross / WH-347 FICA base.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  splitCheckEarnings,
  isReimbursementComponent,
  parseCheckForSupplement,
  getCheckGrossAmount,
} = require('../services/paychexCompanyChecks');
const { mapPaychexCheckToSupplementFields } = require('../services/certifiedPayrollComposer');
const {
  buildSupplementFromPaychex,
  computeWh347Fica,
  roundMoney,
} = require('../services/certifiedPayrollService');
const { buildComponentMap } = require('../services/paychexPayComponents');

const WH347_FICA_RATE = 0.0765;

describe('isReimbursementComponent', () => {
  const map = buildComponentMap([
    { componentId: 'reimb-1', name: 'Truck Reimbursement' },
    { componentId: 'reg-1', name: 'Regular' },
  ]);

  it('matches reimbursement labels and types', () => {
    assert.equal(
      isReimbursementComponent({ name: 'Mileage Reimbursement', amount: 50 }, map),
      true
    );
    assert.equal(
      isReimbursementComponent({ componentId: 'reimb-1', amount: 50 }, map),
      true
    );
    assert.equal(
      isReimbursementComponent(
        { name: 'Expense', componentType: 'REIMBURSEMENT', amount: 10 },
        map
      ),
      true
    );
    assert.equal(
      isReimbursementComponent({ name: 'Regular', amount: 100 }, map),
      false
    );
  });
});

describe('splitCheckEarnings', () => {
  const map = buildComponentMap([
    { componentId: 'reimb-1', name: 'Truck Reimbursement' },
  ]);

  it('excludes reimbursement components from taxableGross', () => {
    const check = {
      earnings: [
        { name: 'Regular', amount: 2000 },
        { name: 'Overtime', amount: 450 },
        { componentId: 'reimb-1', amount: 199 },
      ],
    };
    const split = splitCheckEarnings(check, map);
    assert.equal(split.taxableGross, 2450);
    assert.equal(split.reimbursementAmount, 199);
  });

  it('treats grossEarnings/grossPay as fully taxable when no line items', () => {
    const split = splitCheckEarnings({ grossEarnings: 2849 }, map);
    assert.equal(split.taxableGross, 2849);
    assert.equal(split.reimbursementAmount, 0);
  });

  it('prefers earnings breakdown over inflated grossEarnings', () => {
    const check = {
      grossEarnings: 2849,
      earnings: [
        { name: 'Regular', amount: 2650 },
        { name: 'Truck Reimbursement', amount: 199 },
      ],
    };
    const split = splitCheckEarnings(check, map);
    assert.equal(split.taxableGross, 2650);
    assert.equal(split.reimbursementAmount, 199);
    // Raw total helper still reports Paychex gross for callers that need it
    assert.equal(getCheckGrossAmount(check), 2849);
  });
});

describe('parseCheckForSupplement excludes reimbursements from grossPay', () => {
  const map = buildComponentMap([
    { componentId: 'ded-1', name: 'Health Insurance' },
    { componentId: 'reimb-1', name: 'Truck Reimbursement' },
  ]);

  it('sets grossPay to taxableGross and adds reimbursement back into netPay', () => {
    const taxableGross = 2650;
    const reimbursementAmount = 199;
    const federalWithholding = 0;
    const ss = 164.3;
    const medicare = 38.425;
    const paychexFica = roundMoney(ss + medicare);
    const other = 25;

    const parsed = parseCheckForSupplement(
      {
        earnings: [
          { name: 'Regular', amount: taxableGross },
          { componentId: 'reimb-1', amount: reimbursementAmount },
        ],
        // Inflated Paychex total — must not become grossPay
        grossEarnings: taxableGross + reimbursementAmount,
        netPay: 9999, // ignored when reimbursementAmount > 0
        taxes: [
          { taxType: 'FEDERAL_INCOME', amount: federalWithholding, componentType: 'EMPLOYEE' },
          { taxType: 'SOCIAL_SECURITY', amount: ss, componentType: 'EMPLOYEE' },
          { taxType: 'MEDICARE', amount: medicare, componentType: 'EMPLOYEE' },
        ],
        deductions: [{ componentId: 'ded-1', amount: other }],
      },
      map
    );

    assert.equal(parsed.grossPay, taxableGross);
    assert.equal(parsed.reimbursementAmount, reimbursementAmount);
    assert.ok(parsed.grossPay < taxableGross + reimbursementAmount);
    // Paychex FICA extraction unchanged (not rewritten to 0.0765 here)
    assert.equal(parsed.fica, paychexFica);
    assert.equal(parsed.federalWithholding, federalWithholding);
    assert.equal(
      parsed.netPay,
      roundMoney(
        taxableGross - federalWithholding - paychexFica - other + reimbursementAmount
      )
    );
  });

  it('regression: debug-style check with reimbursement split is internally consistent', () => {
    // workerCheckDebug.jpg reported ~2849 gross / 382.36 FICA / 0 WH / 2657.82 net.
    // Reconstruct with reimbursement carved out so WH-347 FICA uses taxable base only.
    const taxableGross = 2650;
    const reimbursementAmount = 199;
    const inflatedGross = taxableGross + reimbursementAmount; // 2849
    assert.equal(inflatedGross, 2849);

    const federalWithholding = 0;
    const paychexFica = 382.36;
    const other = 0;

    const parsed = parseCheckForSupplement(
      {
        grossEarnings: inflatedGross,
        earnings: [
          { name: 'Regular', amount: taxableGross },
          { name: 'Truck Reimbursement', amount: reimbursementAmount },
        ],
        netPay: 2657.82,
        taxes: [
          { taxType: 'FEDERAL_INCOME', amount: federalWithholding, componentType: 'EMPLOYEE' },
          { taxType: 'SOCIAL_SECURITY', amount: 310.0, componentType: 'EMPLOYEE' },
          { taxType: 'MEDICARE', amount: 72.36, componentType: 'EMPLOYEE' },
        ],
        deductions: [],
      },
      map
    );

    assert.equal(parsed.grossPay, taxableGross);
    assert.equal(parsed.reimbursementAmount, reimbursementAmount);
    assert.equal(parsed.fica, paychexFica);
    assert.equal(
      parsed.netPay,
      roundMoney(taxableGross - federalWithholding - paychexFica - other + reimbursementAmount)
    );

    // WH-347 FICA rate/formula untouched — only the base (taxableGross) changed
    const wh347Fica = computeWh347Fica(parsed.grossPay);
    assert.equal(wh347Fica, roundMoney(taxableGross * WH347_FICA_RATE));
    assert.notEqual(wh347Fica, roundMoney(inflatedGross * WH347_FICA_RATE));
  });
});

describe('certified payroll wiring excludes reimbursements from gross ALL WORK', () => {
  const map = buildComponentMap([
    { componentId: 'ded-1', name: 'Health Insurance' },
  ]);
  const site = { wage_determination_no: 'TX20240001' };
  const worker = {
    workerId: 'w-1',
    workerName: 'Jane Doe',
    paychexWorkerNumber: '101',
  };

  it('composer + buildSupplementFromPaychex use taxable gross for FICA', () => {
    const taxableGross = 2000;
    const reimbursementAmount = 150;
    const rawCheck = {
      workerId: '004WOHNWMFGQKR2RLNJS',
      paycheckId: 'chk-reimb',
      payPeriodId: '1140037241110861',
      checkDate: '2026-07-03',
      grossEarnings: taxableGross + reimbursementAmount,
      netPay: 1800,
      earnings: [
        {
          componentId: 'c1',
          name: 'Regular',
          classificationType: 'EARNINGS',
          amount: taxableGross,
          rate: 25,
          hours: 80,
        },
        {
          componentId: 'c2',
          name: 'Mileage Reimbursement',
          classificationType: 'EARNINGS',
          amount: reimbursementAmount,
        },
      ],
      taxes: [
        { taxType: 'FEDERAL_INCOME', amount: 100, componentType: 'EMPLOYEE' },
        { taxType: 'SOCIAL_SECURITY', amount: 50, componentType: 'EMPLOYEE' },
        { taxType: 'MEDICARE', amount: 20, componentType: 'EMPLOYEE' },
      ],
      deductions: [{ componentId: 'ded-1', amount: 25 }],
    };

    const mapped = mapPaychexCheckToSupplementFields(rawCheck, map);
    assert.equal(mapped.grossAllWork, taxableGross);
    assert.equal(mapped.reimbursementAmount, reimbursementAmount);

    const row = buildSupplementFromPaychex({
      site,
      worker,
      checkData: mapped.parsed,
      mapped,
    });

    assert.equal(row.gross_earned_all_work, taxableGross);
    assert.equal(row.reimbursement_amount, reimbursementAmount);
    assert.equal(row.deduction_fica, computeWh347Fica(taxableGross));
    assert.equal(row.deduction_fica, roundMoney(taxableGross * WH347_FICA_RATE));
    assert.notEqual(
      row.deduction_fica,
      roundMoney((taxableGross + reimbursementAmount) * WH347_FICA_RATE)
    );
    assert.equal(row.net_pay, mapped.netPay);
  });
});
