import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useAppConfig } from '../context/AppConfigContext';
import { apiGet } from '../api/client';

const POLL_MS = 5 * 60 * 1000;

function formatSyncTime(value) {
  if (!value) return '';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}

/**
 * Admin-only banner when the latest Paychex sync for any type has FAILED.
 * Hidden entirely in Non-Paychex mode.
 */
export default function SyncFailureBanner() {
  const { token, isAdmin } = useAuth();
  const { paychexEnabled, capabilities } = useAppConfig();
  const [payload, setPayload] = useState(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!token || !isAdmin || !paychexEnabled || !capabilities?.supportsProviderSync) {
      setPayload(null);
      return undefined;
    }

    let cancelled = false;

    async function load() {
      try {
        const data = await apiGet('/api/sync/status', token);
        if (!cancelled) {
          setPayload(data);
        }
      } catch {
        // Health check itself failing should not spam the UI.
        if (!cancelled) setPayload(null);
      }
    }

    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [token, isAdmin, paychexEnabled, capabilities?.supportsProviderSync]);

  if (!isAdmin || !paychexEnabled || !payload?.hasFailures || dismissed) {
    return null;
  }

  const primary = payload.failures?.[0];
  const alertClass = payload.persistentFailure ? 'alert alert-error' : 'alert alert-warning';

  return (
    <div
      className={alertClass}
      role="alert"
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        gap: '1rem',
        margin: '0 1rem 1rem',
      }}
    >
      <p style={{ margin: 0 }}>
        Some data may be out of date — the last sync from Paychex failed
        {primary
          ? ` (${primary.syncType}: ${primary.message || 'unknown error'}, at ${formatSyncTime(primary.at)})`
          : ''}
        . Try the manual sync button on the relevant page, or contact support if
        this continues.
      </p>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss sync failure banner"
        style={{
          flexShrink: 0,
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          fontSize: '1.25rem',
          lineHeight: 1,
          color: 'inherit',
        }}
      >
        ×
      </button>
    </div>
  );
}
