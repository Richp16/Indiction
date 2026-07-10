const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  calculateGrossThisJob,
  calculateBiweeklyGrossThisJob,
  buildSupplementEstimate,
  mergeBiweeklySupplementFields,
} = require('../services/certifiedPayrollService');
const { estimateDeductions } = require('../services/payrollTaxEstimate');

describe('WH-347 biweekly supplement columns', () => {
  const workerId = 'worker-1';
  const rate = 20;

  const week1Entries = [
    { id: workerId, paychex_component_id: 'REGULAR', hours: 40 },
  ];
  const week2Entries = [
    { id: workerId, paychex_component_id: 'REGULAR', hours: 32 },
    { id: workerId, paychex_component_id: 'OT', hours: 4 },
  ];

  it('calculates weekly gross (7A) from a single week only', () => {
    const week1Gross = calculateGrossThisJob(week1Entries, rate);
    assert.equal(week1Gross, 800);

    const week2Gross = calculateGrossThisJob(week2Entries, rate);
    assert.equal(week2Gross, 760);
  });

  it('calculates biweekly grossAllWork from both weeks combined', () => {
    const biweeklyGross = calculateBiweeklyGrossThisJob(
      [...week1Entries, ...week2Entries],
      workerId,
      rate
    );
    assert.equal(biweeklyGross, 1560);
    assert.notEqual(biweeklyGross, calculateGrossThisJob(week1Entries, rate));
  });

  it('uses full pay period hours for grossAllWork, not selected week only', () => {
    const week2OnlyRows = week2Entries;
    const fullPeriodRows = [...week1Entries, ...week2Entries];

    const week2GrossAllWork = calculateBiweeklyGrossThisJob(week2OnlyRows, workerId, rate);
    const fullPeriodGrossAllWork = calculateBiweeklyGrossThisJob(fullPeriodRows, workerId, rate);

    assert.equal(week2GrossAllWork, 760);
    assert.equal(fullPeriodGrossAllWork, 1560);
    assert.ok(fullPeriodGrossAllWork > week2GrossAllWork);
    assert.ok(fullPeriodGrossAllWork >= calculateGrossThisJob(week2Entries, rate));
  });

  it('estimates deductions on full biweekly gross, not single-week gross', () => {
    const biweeklyGross = 1560;
    const singleWeekGross = 800;

    const biweeklyEstimate = buildSupplementEstimate({
      grossAllWork: biweeklyGross,
      site: { wage_determination_no: 'WD-1' },
      worker: { workerId, workerName: 'Jane Doe', paychexWorkerNumber: '101' },
    });

    const singleWeekEstimate = estimateDeductions(singleWeekGross);

    assert.equal(Number(biweeklyEstimate.gross_earned_all_work), biweeklyGross);
    assert.equal(Number(biweeklyEstimate.deduction_fica), estimateDeductions(biweeklyGross).fica);
    assert.ok(Number(biweeklyEstimate.deduction_fica) > Number(singleWeekEstimate.fica));
    assert.ok(Number(biweeklyEstimate.deduction_withholding) > Number(singleWeekEstimate.federalWithholding));
    assert.equal(biweeklyEstimate.source, 'estimated');
  });

  it('merges biweekly supplement fields from either weekly row', () => {
    const week1Row = {
      worker_id: workerId,
      week_ending_date: '2026-01-07',
      gross_earned_all_work: null,
      deduction_withholding: null,
      net_pay: null,
    };
    const week2Row = {
      worker_id: workerId,
      week_ending_date: '2026-01-14',
      gross_earned_all_work: 1560,
      deduction_withholding: 120,
      deduction_fica: 119.34,
      deduction_other: 0,
      net_pay: 1320.66,
    };

    const merged = mergeBiweeklySupplementFields(week1Row, week2Row);
    assert.equal(Number(merged.gross_earned_all_work), 1560);
    assert.equal(Number(merged.net_pay), 1320.66);
  });
});
