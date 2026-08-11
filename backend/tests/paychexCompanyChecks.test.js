const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  extractWorkerIdFromCheck,
  indexChecksByWorker,
  verifyCheckBelongsToWorker,
  clearCompanyChecksCache,
} = require('../services/paychexCompanyChecks');
const {
  indexChecksByWorkerDetailed,
  mapPaychexCheckToSupplementFields,
} = require('../services/certifiedPayrollComposer');
const {
  buildSupplementFromPaychex,
  buildSupplementTaxDataUnavailable,
  verifiedSupplementFromCheck,
} = require('../services/certifiedPayrollService');

const WORKER_A = '004WORKERAAAAAAA0001';
const WORKER_B = '004WORKERBBBBBBB0002';

function captureWarns(fn) {
  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => {
    warnings.push(args.map(String).join(' '));
  };
  try {
    const result = fn();
    return { result, warnings };
  } finally {
    console.warn = original;
  }
}

function checkPayload({
  workerId,
  employeeId,
  paycheckId,
  gross,
  federal = 100,
  ss = 50,
  medicare = 20,
  omitPrimaryWorkerId = false,
}) {
  const check = {
    paycheckId,
    grossEarnings: gross,
    netPay: gross - federal - ss - medicare,
    taxes: [
      { taxType: 'FEDERAL_INCOME', amount: federal, componentType: 'EMPLOYEE' },
      { taxType: 'SOCIAL_SECURITY', amount: ss, componentType: 'EMPLOYEE' },
      { taxType: 'MEDICARE', amount: medicare, componentType: 'EMPLOYEE' },
    ],
    deductions: [],
  };
  if (!omitPrimaryWorkerId && workerId != null) {
    check.workerId = workerId;
  }
  if (employeeId != null) {
    check.employeeId = employeeId;
  }
  return check;
}

describe('extractWorkerIdFromCheck fallback visibility', () => {
  it('uses primary workerId without warning', () => {
    const { result, warnings } = captureWarns(() =>
      extractWorkerIdFromCheck({ workerId: WORKER_A, paycheckId: 'chk-1' })
    );
    assert.equal(result, WORKER_A);
    assert.equal(warnings.length, 0);
  });

  it('warns when falling back to employeeId', () => {
    const { result, warnings } = captureWarns(() =>
      extractWorkerIdFromCheck({
        employeeId: WORKER_A,
        paycheckId: 'chk-fallback',
      })
    );
    assert.equal(result, WORKER_A);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /check\.workerId absent/);
    assert.match(warnings[0], /employeeId/);
    assert.match(warnings[0], /chk-fallback/);
  });
});

describe('indexChecksByWorker ambiguous overwrite warning', () => {
  it('logs when employeeId fallback collides with another check workerId', () => {
    const checkA = checkPayload({
      workerId: WORKER_A,
      paycheckId: 'chk-A',
      gross: 1700,
      federal: 130.35,
      ss: 100,
      medicare: 30.05,
    });
    // Missing primary workerId; employeeId wrongly points at WORKER_A.
    const checkB = checkPayload({
      omitPrimaryWorkerId: true,
      employeeId: WORKER_A,
      paycheckId: 'chk-B',
      gross: 2100,
      federal: 200,
      ss: 120,
      medicare: 40,
    });

    const { result: indexed, warnings } = captureWarns(() =>
      indexChecksByWorker([checkA, checkB])
    );

    assert.ok(
      warnings.some((w) =>
        w.includes('[paychexCompanyChecks] Ambiguous worker match') &&
        w.includes('chk-B') &&
        w.includes('chk-A') &&
        w.includes(WORKER_A)
      ),
      `expected ambiguous-match warning, got: ${warnings.join(' | ')}`
    );
    // Higher-gross tiebreak unchanged — checkB wins under WORKER_A key.
    assert.equal(indexed[WORKER_A].paycheckId, 'chk-B');
  });
});

describe('write verification refuses collided / fallback-only checks', () => {
  const site = { wage_determination_no: 'WD-TEST' };
  const workerA = {
    workerId: 'local-a',
    workerName: 'Worker A',
    paychexWorkerNumber: 'A1',
    paychexWorkerId: WORKER_A,
  };
  const workerB = {
    workerId: 'local-b',
    workerName: 'Worker B',
    paychexWorkerNumber: 'B1',
    paychexWorkerId: WORKER_B,
  };

  it('refuses to persist when primary workerId is missing (fallback collision path)', () => {
    const collided = checkPayload({
      omitPrimaryWorkerId: true,
      employeeId: WORKER_A,
      paycheckId: 'chk-B',
      gross: 2100,
      federal: 130.35,
      ss: 100,
      medicare: 30.05,
    });

    const { result: verified, warnings } = captureWarns(() =>
      verifiedSupplementFromCheck({
        rawCheck: collided,
        site,
        worker: workerA,
        componentMap: new Map(),
      })
    );

    assert.equal(verified.ok, false);
    assert.equal(verified.reason, 'missing_primary_workerId');
    assert.equal(verified.row, null);
    assert.ok(warnings.some((w) => /Refusing tax write/.test(w)));

    const unavailable = buildSupplementTaxDataUnavailable({
      site,
      worker: workerA,
      reason: verified.reason,
    });
    assert.equal(unavailable.deduction_withholding, null);
    assert.equal(unavailable.deduction_fica, null);
    assert.equal(unavailable.deduction_other, null);
    assert.equal(unavailable.tax_data_unavailable, true);
    assert.equal(unavailable.needs_manual_withholding, true);
  });

  it('accepts a matching primary workerId check', () => {
    const good = checkPayload({
      workerId: WORKER_A,
      paycheckId: 'chk-A',
      gross: 1700,
      federal: 130.35,
      ss: 100,
      medicare: 30.05,
    });

    const verified = verifiedSupplementFromCheck({
      rawCheck: good,
      site,
      worker: workerA,
      componentMap: new Map(),
    });
    assert.equal(verified.ok, true);
    assert.equal(verified.row.deduction_withholding, 130.35);
    assert.equal(String(verified.row.paychex_check_worker_id), WORKER_A);
  });

  it('regression: identical $130.35 / $130.05 cross-assignment is blocked when IDs differ', () => {
    // Reported bug fixture: two workers on same WH-347 erroneously shared
    // withholding $130.35 and FICA $130.05 because fallback matching collided.
    // FICA on WH-347 is 7.65% of gross; use gross that yields 130.05 FICA.
    const GROSS = 1700; // 1700 * 0.0765 = 130.05
    const WITHHOLDING = 130.35;
    const FICA_WH347 = Number((GROSS * 0.0765).toFixed(2));
    assert.equal(FICA_WH347, 130.05);

    const checkForA = checkPayload({
      workerId: WORKER_A,
      paycheckId: 'chk-real-A',
      gross: GROSS,
      federal: WITHHOLDING,
      ss: 100,
      medicare: 30.05,
    });
    // Worker B's real check — different withholding — but payload missing workerId
    // and wrongly tagged with employeeId = WORKER_A (the collision).
    const checkForBMiskeyed = checkPayload({
      omitPrimaryWorkerId: true,
      employeeId: WORKER_A,
      paycheckId: 'chk-miskeyed-B',
      gross: GROSS + 400,
      federal: WITHHOLDING,
      ss: 100,
      medicare: 30.05,
    });

    const { warnings: indexWarnings } = captureWarns(() =>
      indexChecksByWorker([checkForA, checkForBMiskeyed])
    );
    assert.ok(
      indexWarnings.some((w) => w.includes('Ambiguous worker match')),
      'collision must surface ambiguous-match warning'
    );

    const verifiedA = verifiedSupplementFromCheck({
      rawCheck: checkForA,
      site,
      worker: workerA,
      componentMap: new Map(),
    });
    const verifiedBAgainstCollision = verifiedSupplementFromCheck({
      rawCheck: checkForBMiskeyed,
      site,
      worker: workerB,
      componentMap: new Map(),
    });
    const verifiedAAgainstCollision = verifiedSupplementFromCheck({
      rawCheck: checkForBMiskeyed,
      site,
      worker: workerA,
      componentMap: new Map(),
    });

    assert.equal(verifiedA.ok, true);
    assert.equal(verifiedA.row.deduction_withholding, WITHHOLDING);
    assert.equal(Number(verifiedA.row.deduction_fica.toFixed(2)), FICA_WH347);

    // Miskeyed check must not authorize writes for either worker.
    assert.equal(verifiedBAgainstCollision.ok, false);
    assert.equal(verifiedAAgainstCollision.ok, false);

    const badRowA = buildSupplementTaxDataUnavailable({
      site,
      worker: workerA,
      reason: verifiedAAgainstCollision.reason,
    });
    const badRowB = buildSupplementTaxDataUnavailable({
      site,
      worker: workerB,
      reason: verifiedBAgainstCollision.reason,
    });

    // Do not persist the cross-assigned identical tax pair.
    assert.equal(badRowA.deduction_withholding, null);
    assert.equal(badRowA.deduction_fica, null);
    assert.equal(badRowB.deduction_withholding, null);
    assert.equal(badRowB.deduction_fica, null);
    assert.notEqual(badRowA.deduction_withholding, WITHHOLDING);
    assert.notEqual(badRowB.deduction_withholding, WITHHOLDING);

    // Contrast: silently building from collided check WOULD cross-assign —
    // prove the old path would have produced identical values.
    const silentCrossAssign = buildSupplementFromPaychex({
      checkData: mapPaychexCheckToSupplementFields(checkForBMiskeyed).parsed,
      site,
      worker: workerA,
      mapped: mapPaychexCheckToSupplementFields(checkForBMiskeyed),
    });
    assert.equal(silentCrossAssign.deduction_withholding, WITHHOLDING);
    assert.equal(Number(silentCrossAssign.deduction_fica.toFixed(2)), Number(((GROSS + 400) * 0.0765).toFixed(2)));
  });
});

describe('verifyCheckBelongsToWorker', () => {
  it('requires exact string match on primary workerId', () => {
    assert.equal(
      verifyCheckBelongsToWorker({ workerId: WORKER_A, paycheckId: '1' }, WORKER_A).ok,
      true
    );
    assert.equal(
      verifyCheckBelongsToWorker({ workerId: WORKER_A, paycheckId: '1' }, WORKER_B).ok,
      false
    );
    assert.equal(
      verifyCheckBelongsToWorker({ employeeId: WORKER_A, paycheckId: '1' }, WORKER_A).ok,
      false
    );
    assert.equal(verifyCheckBelongsToWorker(null, WORKER_A).ok, false);
  });
});

describe('indexChecksByWorkerDetailed surfaces ambiguous ids', () => {
  it('returns ambiguousWorkerIds when fallback collides', () => {
    const checks = [
      checkPayload({ workerId: WORKER_A, paycheckId: 'a', gross: 900 }),
      checkPayload({
        omitPrimaryWorkerId: true,
        employeeId: WORKER_A,
        paycheckId: 'b',
        gross: 1500,
      }),
    ];
    const { result, warnings } = captureWarns(() => indexChecksByWorkerDetailed(checks));
    assert.deepEqual(result.ambiguousWorkerIds, [WORKER_A]);
    assert.ok(warnings.some((w) => w.includes('Ambiguous worker match')));
  });
});

describe('Paychex display-name tax labels (FUTA must not become FIT)', () => {
  /**
   * Real Paychex /checks payload shape observed for employee codes 63–68:
   * taxType is a human label, componentType is null, and employer FUTA/SUTA
   * lines are interleaved with employee FIT / SS / Medicare.
   */
  function displayNameTaxes({
    fit = 120.15,
    eeSs = 105.4,
    eeMed = 24.65,
    erSs = 105.4,
    erMed = 24.65,
    futa = 10.2,
    suta = 44.2,
  } = {}) {
    return [
      { taxType: 'Employee Medicare Tax', name: 'Employee Medicare Tax', amount: String(eeMed) },
      {
        taxType: 'Employee Social Security Tax',
        name: 'Employee Social Security Tax',
        amount: String(eeSs),
      },
      { taxType: 'Employer Medicare Tax', name: 'Employer Medicare Tax', amount: String(erMed) },
      {
        taxType: 'Employer Social Security Tax',
        name: 'Employer Social Security Tax',
        amount: String(erSs),
      },
      { taxType: 'Federal Income Tax', name: 'Federal Income Tax', amount: String(fit) },
      {
        taxType: 'Federal Unemployment Insurance',
        name: 'Federal Unemployment Insurance',
        amount: String(futa),
      },
      {
        taxType: 'Texas Unemployment Insurance',
        name: 'Texas Unemployment Insurance',
        amount: String(suta),
      },
      {
        taxType:
          'Unemployment Obligation Assessment, Employment and Training Investment Assessment',
        name: 'Unemployment Obligation Assessment, Employment and Training Investment Assessment',
        amount: '1.7',
      },
    ];
  }

  it('regression: Kelvin $130.35 was FIT $120.15 + FUTA $10.20 — keep only FIT', () => {
    const {
      parseCheckForSupplement: parse,
    } = require('../services/paychexCompanyChecks');

    const parsed = parse({
      workerId: '004WOHNWMQB3H9NZC6K8',
      paycheckId: 'chk-kelvin',
      netPay: 1449.8,
      earnings: [{ amount: 1700, name: 'Regular' }],
      taxes: displayNameTaxes({ fit: 120.15, futa: 10.2 }),
      deductions: [],
    });

    assert.equal(parsed.federalWithholding, 120.15);
    assert.notEqual(parsed.federalWithholding, 130.35);
    // Employee SS+Medicare only — employer lines excluded.
    assert.equal(Number(parsed.fica.toFixed(2)), 130.05);
  });

  it('when FIT is $0, FUTA alone must not surface as federal withholding', () => {
    const {
      parseCheckForSupplement: parse,
    } = require('../services/paychexCompanyChecks');

    const parsed = parse({
      workerId: '00UO7ARUMQB1NY04XIUE',
      paycheckId: 'chk-gerardo',
      netPay: 3612.44,
      earnings: [
        { amount: 2125, name: 'Regular' },
        { amount: 1650, name: 'Reimbursement', classificationType: 'REIMBURSEMENT' },
      ],
      taxes: displayNameTaxes({
        fit: 0,
        futa: 12.75,
        eeSs: 131.75,
        eeMed: 30.81,
        erSs: 131.75,
        erMed: 30.81,
        suta: 55.25,
      }),
      deductions: [],
    });

    assert.equal(parsed.federalWithholding, 0);
    assert.notEqual(parsed.federalWithholding, 12.75);
  });

  it('uses paidBy EMPLOYER_LIABILITY to exclude FUTA even without Unemployment label heuristics', () => {
    const {
      parseCheckForSupplement: parse,
    } = require('../services/paychexCompanyChecks');
    const parsed = parse({
      workerId: 'w-paidby',
      paycheckId: 'chk-paidby',
      netPay: 900,
      earnings: [{ amount: 1000, name: 'Hourly' }],
      taxes: [
        {
          name: 'Federal Income Tax',
          paidBy: 'EMPLOYEE_WITHHOLDING',
          amount: '80.00',
        },
        {
          name: 'Federal Unemployment Insurance',
          paidBy: 'EMPLOYER_LIABILITY',
          amount: '6.00',
        },
        {
          name: 'Employee Social Security Tax',
          paidBy: 'EMPLOYEE_WITHHOLDING',
          amount: '62.00',
        },
        {
          name: 'Employer Social Security Tax',
          paidBy: 'EMPLOYER_LIABILITY',
          amount: '62.00',
        },
      ],
      deductions: [],
    });
    assert.equal(parsed.federalWithholding, 80);
    assert.equal(parsed.fica, 62);
  });
});
