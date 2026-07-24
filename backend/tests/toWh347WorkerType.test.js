const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { toWh347WorkerType } = require('../services/certifiedPayrollService');

describe('toWh347WorkerType', () => {
  it('maps RA variants to RA', () => {
    assert.equal(toWh347WorkerType('RA'), 'RA');
    assert.equal(toWh347WorkerType('apprentice'), 'RA');
    assert.equal(toWh347WorkerType('Registered Apprentice'), 'RA');
  });

  it('maps EMPLOYEE and journey labels to J (matches Certified Payroll UI)', () => {
    assert.equal(toWh347WorkerType('EMPLOYEE'), 'J');
    assert.equal(toWh347WorkerType('J'), 'J');
    assert.equal(toWh347WorkerType('JOURNEYMAN'), 'J');
    assert.equal(toWh347WorkerType('journeyworker'), 'J');
    assert.equal(toWh347WorkerType(''), 'J');
    assert.equal(toWh347WorkerType(null), 'J');
    assert.equal(toWh347WorkerType('something-else'), 'J');
  });
});
