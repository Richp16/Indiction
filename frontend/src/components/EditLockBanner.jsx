import { useEditLock } from '../context/EditLockContext';

function humanizeScope(scopeKey) {
  if (!scopeKey) return 'this area';
  if (scopeKey === 'admin_config') return 'company settings and employee config';
  if (scopeKey === 'payroll') return 'payroll';
  if (scopeKey.startsWith('daily_entries:')) return 'daily time entry for this job site';
  if (scopeKey.startsWith('certified_payroll:')) {
    return 'certified payroll for this job site';
  }
  return scopeKey;
}

/**
 * Shows read-only banners for any scopes the current user cannot edit.
 */
export default function EditLockBanner() {
  const { locksByScope } = useEditLock();
  const blocked = Object.entries(locksByScope).filter(
    ([, state]) => state?.status === 'blocked' || state?.readOnly
  );

  if (blocked.length === 0) return null;

  return (
    <div className="edit-lock-banners" role="status" aria-live="polite">
      {blocked.map(([scopeKey, state]) => {
        const holder = state.holderName || state.lock?.holderName || 'another user';
        return (
          <div key={scopeKey} className="alert alert-warning edit-lock-banner">
            <strong>Read-only.</strong> {holder} currently has edit rights for{' '}
            {humanizeScope(scopeKey)}. You can view data, but changes are blocked until
            they finish or the lock times out from inactivity.
          </div>
        );
      })}
    </div>
  );
}
