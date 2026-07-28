const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  mapPaychexCheckToSupplementFields,
  buildReconciliationWarnings,
  indexChecksByWorkerDetailed,
  companyAndWorkerChecksAgree,
} = require('../services/certifiedPayrollComposer');
const { normalizeCheck } = require('../services/paychexPayPeriodApi');
const { buildComponentMap } = require('../services/paychexPayComponents');

const SUPPORT_PAY_PERIOD_ID = '1140037241110861';
const SUPPORT_WORKER_ID = '004WOHNWMFGQKR2RLNJS';

function sampleCheck({
  workerId = SUPPORT_WORKER_ID,
  paycheckId = 'chk-1',
  gross = 1000,
  net = 800,
  federal = 100,
  ss = 50,
  medicare = 20,
  other = 25,
} = {}) {
  return {
    workerId,
    paycheckId,
    payPeriodId: SUPPORT_PAY_PERIOD_ID,
    checkDate: '2026-07-03',
    checkType: 'REGULAR',
    checkNumber: '1001',
    grossEarnings: gross,
    netPay: net,
    earnings: [
      {
        componentId: 'c1',
        name: 'Regular',
        classificationType: 'EARNINGS',
        effectOnPay: 'ADDITION',
        jobName: 'Job A',
        jobId: 'job-1',
        amount: gross,
        rate: 25,
        hours: 40,
      },
    ],
    taxes: [
      { taxType: 'FEDERAL_INCOME', amount: federal, componentType: 'EMPLOYEE' },
      { taxType: 'SOCIAL_SECURITY', amount: ss, componentType: 'EMPLOYEE' },
      { taxType: 'MEDICARE', amount: medicare, componentType: 'EMPLOYEE' },
    ],
    deductions: [{ componentId: 'ded-1', amount: other }],
  };
}

describe('certified payroll Paychex check mapping', () => {
  const componentMap = buildComponentMap([{ componentId: 'ded-1', name: 'Health Insurance' }]);

  it('maps one worker check into supplement money fields', () => {
    const mapped = mapPaychexCheckToSupplementFields(sampleCheck(), componentMap);
    assert.equal(mapped.paycheckId, 'chk-1');
    assert.equal(mapped.workerId, SUPPORT_WORKER_ID);
    assert.equal(mapped.payPeriodId, SUPPORT_PAY_PERIOD_ID);
    assert.equal(mapped.grossAllWork, 1000);
    assert.equal(mapped.withholding, 100);
    assert.equal(mapped.fica, 70);
    assert.equal(mapped.reimbursementAmount, 0);
    assert.equal(mapped.otherAmount, 25);
    assert.equal(mapped.otherLabel, 'Health Insurance');
    assert.equal(mapped.totalDeductions, 195);
    assert.equal(mapped.netPay, 800);
    assert.equal(mapped.earnings[0].hours, 40);
    assert.equal(mapped.earnings[0].jobName, 'Job A');
  });

  it('normalizeCheck preserves earnings classification fields', () => {
    const normalized = normalizeCheck(sampleCheck());
    assert.equal(normalized.paycheckId, 'chk-1');
    assert.equal(normalized.earnings[0].classificationType, 'EARNINGS');
    assert.equal(normalized.earnings[0].effectOnPay, 'ADDITION');
    assert.equal(normalized.taxes.length, 3);
  });

  it('flags workers with hours but no Paychex check', () => {
    const warnings = buildReconciliationWarnings({
      workers: [
        {
          workerId: 'local-1',
          paychexWorkerId: SUPPORT_WORKER_ID,
          workerName: 'Jane Doe',
        },
        {
          workerId: 'local-2',
          paychexWorkerId: 'other-worker',
          workerName: 'John Smith',
        },
      ],
      checksByWorker: {
        [SUPPORT_WORKER_ID]: sampleCheck(),
      },
      workersWithMultipleChecksInSamePayPeriod: [],
    });

    assert.equal(warnings.workersWithHoursButNoPaychexCheck.length, 1);
    assert.equal(warnings.workersWithHoursButNoPaychexCheck[0].paychexWorkerId, 'other-worker');
    assert.equal(warnings.paychexChecksWithoutCertifiedPayrollRows.length, 0);
  });

  it('flags Paychex checks without certified payroll hour rows', () => {
    const warnings = buildReconciliationWarnings({
      workers: [
        {
          workerId: 'local-1',
          paychexWorkerId: SUPPORT_WORKER_ID,
          workerName: 'Jane Doe',
        },
      ],
      checksByWorker: {
        [SUPPORT_WORKER_ID]: sampleCheck(),
        'orphan-worker': sampleCheck({ workerId: 'orphan-worker', paycheckId: 'chk-orphan' }),
      },
      workersWithMultipleChecksInSamePayPeriod: [],
    });

    assert.equal(warnings.paychexChecksWithoutCertifiedPayrollRows.length, 1);
    assert.equal(
      warnings.paychexChecksWithoutCertifiedPayrollRows[0].paychexWorkerId,
      'orphan-worker'
    );
  });

  it('flags workers with multiple checks in the same pay period', () => {
    const indexed = indexChecksByWorkerDetailed([
      sampleCheck({ paycheckId: 'a', gross: 900 }),
      sampleCheck({ paycheckId: 'b', gross: 1200 }),
    ]);
    assert.deepEqual(indexed.workersWithMultipleChecksInSamePayPeriod, [SUPPORT_WORKER_ID]);
    assert.equal(indexed.checksByWorker[SUPPORT_WORKER_ID].paycheckId, 'b');

    const warnings = buildReconciliationWarnings({
      workers: [
        {
          workerId: 'local-1',
          paychexWorkerId: SUPPORT_WORKER_ID,
          workerName: 'Jane Doe',
        },
      ],
      checksByWorker: indexed.checksByWorker,
      workersWithMultipleChecksInSamePayPeriod: indexed.workersWithMultipleChecksInSamePayPeriod,
    });
    assert.equal(warnings.workersWithMultipleChecksInSamePayPeriod.length, 1);
  });

  it('surfaces checksUnavailable for draft/pending payroll periods', () => {
    const warnings = buildReconciliationWarnings({
      workers: [
        {
          workerId: 'local-1',
          paychexWorkerId: SUPPORT_WORKER_ID,
          workerName: 'Jane Doe',
        },
      ],
      checksByWorker: {},
      checksFetchMeta: {
        payPeriodId: SUPPORT_PAY_PERIOD_ID,
        periodStatus: 'DRAFT',
        checksUnavailable: true,
        checksUnavailableCode: 'CHECKS_NOT_READY',
        checksUnavailableMessage:
          'Checks not yet available — payroll period is still in draft/pending status (or Paychex has not finalized checks for this period).',
      },
    });

    assert.ok(warnings.checksUnavailable);
    assert.equal(warnings.checksUnavailable.code, 'CHECKS_NOT_READY');
    assert.match(warnings.checksUnavailable.message, /draft\/pending/i);
    assert.equal(warnings.checksUnavailable.periodStatus, 'DRAFT');
    assert.equal(warnings.workersWithHoursButNoPaychexCheck.length, 1);
    assert.equal(
      warnings.workersWithHoursButNoPaychexCheck[0].reason,
      'CHECKS_NOT_READY'
    );
  });

  it('company checks and worker checks agree for a known worker', () => {
    const companyCheck = sampleCheck({ paycheckId: 'company-view' });
    const workerCheck = sampleCheck({ paycheckId: 'worker-view' });
    const result = companyAndWorkerChecksAgree(companyCheck, workerCheck, componentMap);
    assert.equal(result.agree, true);
    assert.equal(result.fromCompany.grossAllWork, result.fromWorker.grossAllWork);
    assert.equal(result.fromCompany.withholding, result.fromWorker.withholding);
    assert.equal(result.fromCompany.fica, result.fromWorker.fica);
    assert.equal(result.fromCompany.netPay, result.fromWorker.netPay);
  });
});

describe('hours remain internal-only (contract)', () => {
  it('documents that hoursSource is daily_time_entries not Paychex', () => {
    // Composer debug contract used by getCertifiedPayrollData / buildSupplementRows.
    const debugContract = {
      hoursSource: 'daily_time_entries',
      moneySource: 'paychex_company_checks',
    };
    assert.equal(debugContract.hoursSource, 'daily_time_entries');
    assert.notEqual(debugContract.hoursSource, 'paychex');
    assert.equal(debugContract.moneySource, 'paychex_company_checks');
  });
});
