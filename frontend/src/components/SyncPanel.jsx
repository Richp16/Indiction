import { useState, useEffect } from 'react';
import client from '../api/client';

const SYNC_TYPE_LABELS = {
  workers: 'Workers',
  pay_components: 'Pay Components',
  job_sites: 'Job Sites',
  pay_periods: 'Pay Periods',
};

function formatSyncTime(timestamp) {
  if (!timestamp) return 'Never';
  return new Date(timestamp).toLocaleString();
}

export default function SyncPanel() {
  const [syncStatus, setSyncStatus] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState(null);
  const [messageType, setMessageType] = useState('success');

  async function fetchStatus() {
    setLoading(true);
    try {
      const response = await client.get('/api/sync/status');
      setSyncStatus(response.data);
    } catch (err) {
      setMessage(err.response?.data?.message || 'Failed to load sync status');
      setMessageType('error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchStatus();
  }, []);

  async function handleSyncNow() {
    setSyncing(true);
    setMessage(null);
    try {
      const response = await client.post('/api/sync');
      const failed = response.data.results?.filter((r) => r.status === 'FAILED');
      if (failed?.length > 0) {
        setMessage(`Sync completed with ${failed.length} failure(s)`);
        setMessageType('warning');
      } else {
        setMessage('Sync completed successfully');
        setMessageType('success');
      }
      await fetchStatus();
    } catch (err) {
      setMessage(err.response?.data?.message || 'Sync failed');
      setMessageType('error');
    } finally {
      setSyncing(false);
    }
  }

  const types = ['workers', 'pay_components', 'job_sites', 'pay_periods'];

  return (
    <div>
      {loading ? (
        <div style={{ textAlign: 'center', padding: 'var(--space-4)' }}>
          <span className="spinner" aria-label="Loading sync status" />
        </div>
      ) : (
        <div className="sync-grid">
          {types.map((type) => {
            const record = syncStatus.find((s) => s.sync_type === type);
            return (
              <div key={type} className="sync-item">
                <div className="sync-item-label">{SYNC_TYPE_LABELS[type]}</div>
                <div className="sync-item-time">
                  {formatSyncTime(record?.last_ran_at)}
                </div>
                {record?.status && (
                  <span
                    className={`badge ${
                      record.status === 'SUCCESS' ? 'badge-success' : 'badge-error'
                    }`}
                    style={{ marginTop: 'var(--space-2)' }}
                  >
                    {record.status}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {message && (
        <div className={`alert alert-${messageType}`}>{message}</div>
      )}

      <button
        type="button"
        className="btn btn-primary"
        onClick={handleSyncNow}
        disabled={syncing}
      >
        {syncing ? 'Syncing…' : 'Sync Now'}
      </button>
    </div>
  );
}
