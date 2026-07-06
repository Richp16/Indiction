import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiGet } from '../api/client';

function formatWorkerName(entry) {
  const name = `${entry.worker_first_name || ''} ${entry.worker_last_name || ''}`.trim();
  return name || '—';
}

function formatPayCode(entry) {
  return entry.paychex_component_id || entry.component_name || '—';
}

function formatHours(entry) {
  const hours = Number(entry.hours);
  if (Number.isFinite(hours) && hours > 0) {
    return hours.toFixed(1);
  }
  const amount = Number(entry.reimbursement_amount);
  if (Number.isFinite(amount) && amount > 0) {
    return `$${amount.toFixed(2)}`;
  }
  return '—';
}

export default function SummaryPage() {
  const { token } = useAuth();
  const [period, setPeriod] = useState(null);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError('');
      try {
        const periodData = await apiGet('/api/pay-periods/current', token);
        setPeriod(periodData);
        const entryData = await apiGet(
          `/api/entries?payPeriodId=${periodData.id}`,
          token
        );
        setEntries(entryData);
      } catch (err) {
        setError(err.message || 'Failed to load summary');
        setEntries([]);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [token]);

  if (loading) {
    return <p>Loading…</p>;
  }

  return (
    <div>
      <h1>Summary</h1>

      {period && (
        <p>
          Pay period: {period.start_date} – {period.end_date}
        </p>
      )}

      {error && <p style={{ color: 'crimson' }}>{error}</p>}

      {entries.length === 0 && !error && (
        <p>No time entries for this pay period.</p>
      )}

      {entries.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>Worker</th>
              <th style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>Job Site</th>
              <th style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>Date</th>
              <th style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>Pay Code</th>
              <th style={{ textAlign: 'right', borderBottom: '1px solid #ccc' }}>Hours</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td style={{ borderBottom: '1px solid #eee' }}>{formatWorkerName(entry)}</td>
                <td style={{ borderBottom: '1px solid #eee' }}>{entry.job_site_name || '—'}</td>
                <td style={{ borderBottom: '1px solid #eee' }}>{entry.entry_date || '—'}</td>
                <td style={{ borderBottom: '1px solid #eee' }}>{formatPayCode(entry)}</td>
                <td style={{ textAlign: 'right', borderBottom: '1px solid #eee' }}>
                  {formatHours(entry)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
