import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiGet, apiPost } from '../api/client';

export default function Settings() {
  const { token } = useAuth();
  const [syncResults, setSyncResults] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [syncing, setSyncing] = useState(false);
  const [loadingAlerts, setLoadingAlerts] = useState(false);
  const [error, setError] = useState('');

  async function handleSync() {
    setSyncing(true);
    setError('');
    try {
      const result = await apiPost('/api/sync', {}, token);
      setSyncResults(result);
    } catch (err) {
      setError(err.message || 'Sync failed');
    } finally {
      setSyncing(false);
    }
  }

  async function handleLoadAlerts() {
    setLoadingAlerts(true);
    setError('');
    try {
      const result = await apiGet('/api/alerts', token);
      setAlerts(result.alerts || []);
    } catch (err) {
      setError(err.message || 'Failed to load alerts');
      setAlerts([]);
    } finally {
      setLoadingAlerts(false);
    }
  }

  return (
    <div>
      <h1>Settings</h1>

      {error && <p style={{ color: 'crimson' }}>{error}</p>}

      <section style={{ marginBottom: '2rem' }}>
        <h2>Sync</h2>
        <button type="button" onClick={handleSync} disabled={syncing}>
          {syncing ? 'Running sync…' : 'Run full sync now'}
        </button>
        {syncResults && (
          <pre style={{ marginTop: '1rem', background: '#f5f5f5', padding: '1rem' }}>
            {JSON.stringify(syncResults, null, 2)}
          </pre>
        )}
      </section>

      <section>
        <h2>Alerts</h2>
        <button type="button" onClick={handleLoadAlerts} disabled={loadingAlerts}>
          {loadingAlerts ? 'Loading alerts…' : 'View alerts'}
        </button>
        {alerts.length === 0 && !loadingAlerts && (
          <p style={{ marginTop: '1rem' }}>No alerts loaded yet.</p>
        )}
        {alerts.length > 0 && (
          <ul style={{ marginTop: '1rem' }}>
            {alerts.map((alert, index) => (
              <li key={alert.periodId || index}>
                <strong>[{alert.severity}]</strong> {alert.message}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
