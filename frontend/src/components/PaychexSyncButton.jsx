import { useState, useEffect, useCallback } from 'react';
import { apiGet } from '../api/client';

function formatRelativeTime(timestamp) {
  if (!timestamp) return null;
  const then = new Date(timestamp).getTime();
  if (Number.isNaN(then)) return null;
  const mins = Math.floor((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/**
 * Shared Paychex sync control: loading state, success/error feedback,
 * optional last-synced timestamp from sync_log.
 */
export default function PaychexSyncButton({
  label,
  onSync,
  token,
  syncType = null,
  disabled = false,
  className = 'btn btn-secondary',
  style,
}) {
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [lastSyncedAt, setLastSyncedAt] = useState(null);

  const refreshLastSynced = useCallback(async () => {
    if (!syncType || !token) return;
    try {
      const data = await apiGet(
        `/api/paychex/sync-status?type=${encodeURIComponent(syncType)}`,
        token
      );
      setLastSyncedAt(data?.lastRanAt || null);
    } catch {
      // Non-blocking — hide last-synced if status fetch fails
    }
  }, [syncType, token]);

  useEffect(() => {
    refreshLastSynced();
  }, [refreshLastSynced]);

  async function handleClick() {
    if (syncing || disabled) return;
    setSyncing(true);
    setMessage('');
    setError('');
    try {
      const result = await onSync();
      const nextMessage =
        typeof result === 'string'
          ? result
          : result?.message || 'Synced successfully.';
      setMessage(nextMessage);
      await refreshLastSynced();
    } catch (err) {
      setError(err.message || 'Sync failed');
    } finally {
      setSyncing(false);
    }
  }

  const relative = formatRelativeTime(lastSyncedAt);

  return (
    <div className="paychex-sync">
      <button
        type="button"
        className={className}
        style={style}
        onClick={handleClick}
        disabled={disabled || syncing}
        aria-busy={syncing}
      >
        {syncing ? 'Syncing…' : label}
      </button>
      {relative && (
        <span className="paychex-sync__meta">Last synced: {relative}</span>
      )}
      {message && !error && <p className="paychex-sync__message">{message}</p>}
      {error && <p className="paychex-sync__error">{error}</p>}
    </div>
  );
}
