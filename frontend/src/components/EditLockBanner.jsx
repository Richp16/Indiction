import { useEditLock } from '../context/EditLockContext';

/**
 * App-wide read-only banner when another user holds the global edit lock.
 */
export default function EditLockBanner() {
  const { ready, isEditor, editingUser } = useEditLock();

  if (!ready || isEditor || !editingUser) return null;

  const holder = editingUser.name || 'another user';
  const role = editingUser.role ? ` (${editingUser.role.replace(/_/g, ' ')})` : '';

  return (
    <div className="edit-lock-banners" role="status" aria-live="polite">
      <div className="alert alert-warning edit-lock-banner">
        <strong>Read-only.</strong> {holder}
        {role} currently has edit rights for the whole app. You can view data, but
        changes are blocked until they finish or the lock times out from inactivity.
      </div>
    </div>
  );
}
