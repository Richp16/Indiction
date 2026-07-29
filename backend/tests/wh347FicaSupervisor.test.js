const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildSupplementFromPaychex,
  buildSupplementEstimate,
  groupWorkersFromHours,
  computeWh347Fica,
  isSupervisorClassification,
} = require('../services/certifiedPayrollService');

const site = { wage_determination_no: 'TX20240001' };
const worker = {
  workerId: 'w-1',
  workerName: 'Jane Doe',
  paychexWorkerNumber: '101',
};

describe('WH-347 FICA is always 7.65% of gross ALL WORK', () => {
  it('computeWh347Fica returns full-precision 7.65% of gross', () => {
    assert.equal(computeWh347Fica(2000), 2000 * 0.0765);
    assert.equal(computeWh347Fica(2775.65), 2775.65 * 0.0765);
    assert.equal(computeWh347Fica(0), 0);
    assert.equal(computeWh347Fica(null), 0);
  });

  it('buildSupplementFromPaychex ignores Paychex FICA and computes 7.65% of gross', () => {
    const row = buildSupplementFromPaychex({
      site,
      worker,
      checkData: {
        grossPay: 2000,
        federalWithholding: 250,
        fica: 999.99, // Paychex-reported FICA must be ignored
        netPay: 1500,
        otherDeductions: [{ label: 'Health', amount: 50 }],
      },
      mapped: null,
    });

    const expectedFica = 2000 * 0.0765;
    assert.equal(row.deduction_fica, expectedFica);
    assert.notEqual(row.deduction_fica, 999.99);
    // Regression: other money fields unchanged
    assert.equal(row.gross_earned_all_work, 2000);
    assert.equal(row.deduction_withholding, 250);
    assert.equal(row.deduction_other, 50);
    assert.equal(row.net_pay, 1500);
    // total_deductions recomputed with the 7.65% FICA
    assert.equal(row.total_deductions, 250 + expectedFica + 50);
  });

  it('buildSupplementFromPaychex with mapped check also ignores mapped.fica', () => {
    const row = buildSupplementFromPaychex({
      site,
      worker,
      checkData: { otherDeductions: [] },
      mapped: {
        grossAllWork: 2775.65,
        withholding: 300,
        fica: 111.11, // must be ignored
        netPay: 2100,
        otherAmount: 25,
        otherLabel: 'Dues',
        paycheckId: 'chk-1',
        workerId: 'pcx-1',
        totalDeductions: 436.11, // stale — must be recomputed
      },
    });

    const expectedFica = 2775.65 * 0.0765;
    assert.equal(row.deduction_fica, expectedFica);
    assert.equal(row.total_deductions, 300 + expectedFica + 25);
  });

  it('buildSupplementEstimate computes FICA as 7.65% of estimated gross', () => {
    const row = buildSupplementEstimate({ grossAllWork: 2000, site, worker });
    assert.equal(row.deduction_fica, computeWh347Fica(row.gross_earned_all_work));
    assert.equal(row.deduction_fica, Number(row.gross_earned_all_work) * 0.0765);
  });
});

describe('Supervisors are excluded from WH-347 workers', () => {
  const baseRow = {
    paychex_worker_id: 'pcx-1',
    identifying_number: '101',
    pay_rate: '25',
    worker_type: 'EMPLOYEE',
    entry_id: 'e1',
    entry_date: '2026-07-20',
    paychex_component_id: 'REGULAR',
    hours: '8',
  };

  it('isSupervisorClassification matches case-insensitively', () => {
    assert.equal(isSupervisorClassification('Supervisor'), true);
    assert.equal(isSupervisorClassification('SUPERVISOR'), true);
    assert.equal(isSupervisorClassification(' supervisor '), true);
    assert.equal(isSupervisorClassification('Labor'), false);
    assert.equal(isSupervisorClassification(''), false);
    assert.equal(isSupervisorClassification(null), false);
  });

  it('groupWorkersFromHours drops Supervisor rows entirely', () => {
    const workers = groupWorkersFromHours([
      {
        ...baseRow,
        id: 'w-sup',
        first_name: 'Sam',
        last_name: 'Supervisor',
        labor_classification: 'Supervisor',
      },
      {
        ...baseRow,
        id: 'w-lab',
        first_name: 'Lena',
        last_name: 'Labor',
        labor_classification: 'Labor',
      },
    ]);

    assert.equal(workers.length, 1);
    assert.equal(workers[0].workerId, 'w-lab');
    assert.equal(workers[0].laborClassification, 'Labor');
    assert.equal(workers[0].needsClassification, false);
  });

  it('groupWorkersFromHours sets needsClassification when classification is missing', () => {
    const workers = groupWorkersFromHours([
      {
        ...baseRow,
        id: 'w-missing',
        first_name: 'Manuel',
        last_name: 'Calderon',
        labor_classification: null,
      },
      {
        ...baseRow,
        id: 'w-ok',
        first_name: 'Lena',
        last_name: 'Labor',
        labor_classification: 'Laborer',
      },
    ]);

    assert.equal(workers.length, 2);
    const missing = workers.find((w) => w.workerId === 'w-missing');
    const ok = workers.find((w) => w.workerId === 'w-ok');
    assert.equal(missing.needsClassification, true);
    assert.equal(missing.laborClassification, '');
    assert.equal(ok.needsClassification, false);
    assert.equal(ok.laborClassification, 'Laborer');
  });
});
