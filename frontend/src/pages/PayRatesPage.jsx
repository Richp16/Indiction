import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiDelete, apiGet, apiPost } from '../api/client';

function formatMoney(value) {
  if (value == null || value === '') return '—';
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '—';
  return amount.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default function PayRatesPage() {
  const { token } = useAuth();
  const [workers, setWorkers] = useState([]);
  const [jobSites, setJobSites] = useState([]);
  const [overrides, setOverrides] = useState([]);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState({
    workerId: '',
    jobSiteId: '',
    rate: '',
  });

  async function load() {
    const data = await apiGet('/api/job-site-rates', token);
    setWorkers(data.workers || []);
    setJobSites(data.jobSites || []);
    setOverrides(data.overrides || []);
  }

  useEffect(() => {
    if (!token) return;
    load().catch((err) => setError(err.message));
  }, [token]);

  const selectedWorker = useMemo(
    () => workers.find((w) => w.id === draft.workerId) || null,
    [workers, draft.workerId]
  );

  const assignedSiteIdsForWorker = useMemo(() => {
    if (!draft.workerId) return new Set();
    return new Set(
      overrides.filter((o) => o.workerId === draft.workerId).map((o) => o.jobSiteId)
    );
  }, [overrides, draft.workerId]);

  async function handleSaveOverride(event) {
    event.preventDefault();
    setError('');
    setSuccessMessage('');

    if (!draft.workerId || !draft.jobSiteId || !draft.rate) {
      setError('Worker, job site, and rate are required.');
      return;
    }

    setSaving(true);
    try {
      await apiPost(
        '/api/job-site-rates',
        {
          workerId: draft.workerId,
          jobSiteId: draft.jobSiteId,
          rate: Number(draft.rate),
        },
        token
      );
      setDraft({ workerId: draft.workerId, jobSiteId: '', rate: '' });
      await load();
      setSuccessMessage('Job-site rate saved.');
      window.setTimeout(() => setSuccessMessage(''), 2500);
    } catch (err) {
      setError(err.message || 'Failed to save rate override');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(override) {
    if (
      !window.confirm(
        `Remove the ${formatMoney(override.rate)} override for ${override.workerName} at ${override.jobSiteName}? They will fall back to their default rate.`
      )
    ) {
      return;
    }

    setError('');
    setSuccessMessage('');
    try {
      await apiDelete(`/api/job-site-rates/${override.id}`, token);
      await load();
      setSuccessMessage('Override removed.');
      window.setTimeout(() => setSuccessMessage(''), 2500);
    } catch (err) {
      setError(err.message || 'Failed to remove override');
    }
  }

  return (
    <div>
      <h1>Pay Rates</h1>

      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      {successMessage && <p style={{ color: '#15803d' }}>{successMessage}</p>}

      <h2 style={{ marginTop: '1.5rem' }}>Add / update override</h2>
      <form
        onSubmit={handleSaveOverride}
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
          marginBottom: 24,
          alignItems: 'flex-end',
        }}
      >
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 13, color: '#555' }}>Worker</span>
          <select
            value={draft.workerId}
            onChange={(e) =>
              setDraft((d) => ({ ...d, workerId: e.target.value, jobSiteId: '' }))
            }
            style={{ minWidth: 220, padding: '0.35rem 0.5rem' }}
          >
            <option value="">Select worker…</option>
            {workers.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
                {w.employeeCode ? ` (#${w.employeeCode})` : ''}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 13, color: '#555' }}>Job site</span>
          <select
            value={draft.jobSiteId}
            onChange={(e) => setDraft((d) => ({ ...d, jobSiteId: e.target.value }))}
            disabled={!draft.workerId}
            style={{ minWidth: 220, padding: '0.35rem 0.5rem' }}
          >
            <option value="">Select job site…</option>
            {jobSites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.name}
                {site.jobCode ? ` (${site.jobCode})` : ''}
                {assignedSiteIdsForWorker.has(site.id) ? ' — update existing' : ''}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 13, color: '#555' }}>Rate</span>
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={draft.rate}
            onChange={(e) => setDraft((d) => ({ ...d, rate: e.target.value }))}
            placeholder="0.00"
            style={{ width: 120, padding: '0.35rem 0.5rem' }}
          />
        </label>

        <button type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save override'}
        </button>

        {selectedWorker && (
          <span style={{ color: '#64748b', fontSize: 13, alignSelf: 'center' }}>
            Default rate: {formatMoney(selectedWorker.standardRate)}
          </span>
        )}
      </form>

      <h2>Current overrides</h2>
      <table>
        <thead>
          <tr>
            <th style={{ textAlign: 'left' }}>Worker</th>
            <th style={{ textAlign: 'left' }}>Default rate</th>
            <th style={{ textAlign: 'left' }}>Job site</th>
            <th style={{ textAlign: 'right' }}>Override rate</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {overrides.length === 0 && (
            <tr>
              <td colSpan={5} style={{ color: '#666' }}>
                No job-site rate overrides yet. Workers use their default rate everywhere.
              </td>
            </tr>
          )}
          {overrides.map((row) => (
            <tr key={row.id}>
              <td>
                {row.workerName}
                {row.employeeCode ? ` (#${row.employeeCode})` : ''}
              </td>
              <td style={{ color: '#64748b' }}>{formatMoney(row.standardRate)}</td>
              <td>
                {row.jobSiteName}
                {row.jobCode ? ` (${row.jobCode})` : ''}
              </td>
              <td style={{ textAlign: 'right' }}>{formatMoney(row.rate)}</td>
              <td>
                <button type="button" onClick={() => handleDelete(row)}>
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

