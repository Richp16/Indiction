/**
 * Role-based Daily Entry date window (Sunday–Saturday current week for non-admins).
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  assertEntryDateAllowedForRole,
  ADMIN_ROLES,
} = require('../routes/entries');
const { getWeekBounds } = require('../services/entryPayCode');

describe('assertEntryDateAllowedForRole', () => {
  it('treats system_admin and payroll_admin as unrestricted for date window', () => {
    for (const role of ADMIN_ROLES) {
      assert.doesNotThrow(() =>
        assertEntryDateAllowedForRole(role, '2010-01-01')
      );
      assert.doesNotThrow(() =>
        assertEntryDateAllowedForRole(role, '2099-12-31')
      );
    }
  });

  it('allows superintendent dates inside the current Sunday–Saturday week', () => {
    const today = new Date().toISOString().split('T')[0];
    const { sunday, saturday } = getWeekBounds(today);
    assert.doesNotThrow(() =>
      assertEntryDateAllowedForRole('superintendent', sunday)
    );
    assert.doesNotThrow(() =>
      assertEntryDateAllowedForRole('superintendent', saturday)
    );
    assert.doesNotThrow(() =>
      assertEntryDateAllowedForRole('superintendent', today)
    );
  });

  it('blocks superintendent dates outside the current week with 403', () => {
    const today = new Date().toISOString().split('T')[0];
    const { sunday } = getWeekBounds(today);
    const before = new Date(`${sunday}T12:00:00Z`);
    before.setUTCDate(before.getUTCDate() - 1);
    const pastDate = before.toISOString().split('T')[0];

    assert.throws(
      () => assertEntryDateAllowedForRole('superintendent', pastDate),
      (err) =>
        err.statusCode === 403 &&
        /outside the current week/i.test(err.message)
    );
  });
});
