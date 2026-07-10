const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { mapPaychexError, isRetryableNetworkError } = require('../services/paychexErrors');

describe('mapPaychexError', () => {
  it('classifies 401 as auth error', () => {
    const err = mapPaychexError({
      response: { status: 401, data: { message: 'Unauthorized' } },
      message: 'Request failed',
    });
    assert.equal(err.paychexErrorType, 'auth');
    assert.match(err.message, /Paychex auth error \(401\)/);
  });

  it('classifies 403 as auth error', () => {
    const err = mapPaychexError({
      response: { status: 403, data: { message: 'Forbidden' } },
    });
    assert.equal(err.paychexErrorType, 'auth');
  });

  it('classifies 422 as client error', () => {
    const err = mapPaychexError({
      response: { status: 422, data: { errors: ['bad field'] } },
    });
    assert.equal(err.paychexErrorType, 'client');
    assert.match(err.message, /Paychex HTTP 422/);
  });

  it('classifies 500 as server error', () => {
    const err = mapPaychexError({
      response: { status: 500, data: 'Internal error' },
    });
    assert.equal(err.paychexErrorType, 'server');
  });

  it('classifies ETIMEDOUT as network error', () => {
    const err = mapPaychexError({
      code: 'ETIMEDOUT',
      message: 'connect ETIMEDOUT 141.123.222.53:443',
    });
    assert.equal(err.paychexErrorType, 'network');
    assert.equal(err.networkCode, 'ETIMEDOUT');
    assert.match(err.message, /Paychex network error \(ETIMEDOUT\)/);
    assert.doesNotMatch(err.message, /authentication failed/i);
  });

  it('classifies ECONNRESET as network error', () => {
    const err = mapPaychexError({
      code: 'ECONNRESET',
      message: 'read ECONNRESET',
    });
    assert.equal(err.paychexErrorType, 'network');
    assert.match(err.message, /ECONNRESET/);
  });
});

describe('isRetryableNetworkError', () => {
  it('returns true for ETIMEDOUT without response', () => {
    assert.equal(isRetryableNetworkError({ code: 'ETIMEDOUT' }), true);
  });

  it('returns false for HTTP 500 with response', () => {
    assert.equal(
      isRetryableNetworkError({ response: { status: 500 }, code: 'ERR_BAD_RESPONSE' }),
      false
    );
  });
});
