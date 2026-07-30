import { useState, useEffect, useMemo, Fragment } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { apiGet, API_BASE_URL } from '../api/client';
import PayPeriodSelector from '../components/PayPeriodSelector';
import { downloadFile } from '../utils/downloadFile';

function formatWorkerName(entry) {
  const name = `${entry.worker_first_name || ''} ${entry.worker_last_name || ''}`.trim();
  return name || '—';
}

function formatPayCodeLabel(entry) {
  return entry.component_name || entry.paychex_component_id || entry.pay_code || '—';
}

function isReimbursementEntry(entry) {
  const code = String(entry.pay_code || entry.paychex_component_id || '').toUpperCase();
  const name = String(entry.component_name || '').toLowerCase();
  return (
    code.includes('REIMBURSE') ||
    name.includes('reimburse') ||
    (Number(entry.reimbursement_amount) !== 0 && Number(entry.hours) === 0)
  );
}

function formatHoursValue(entry) {
  const hours = Number(entry.hours);
  if (Number.isFinite(hours) && hours !== 0) {
    return hours.toFixed(1);
  }
  return '—';
}

function formatReimbValue(entry) {
  const amount = Number(entry.reimbursement_amount);
  if (Number.isFinite(amount) && amount !== 0) {
    return `$${amount.toFixed(2)}`;
  }
  return '—';
}

function formatDateHeading(dateStr) {
  if (!dateStr) return 'Unknown date';
  const date = new Date(`${String(dateStr).split('T')[0]}T12:00:00`);
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function groupEntriesByDate(entries) {
  const groups = [];
  const byDate = new Map();
  for (const entry of entries) {
    const key = String(entry.entry_date || '').split('T')[0] || 'unknown';
    if (!byDate.has(key)) {
      byDate.set(key, []);
      groups.push({ date: key, entries: byDate.get(key) });
    }
    byDate.get(key).push(entry);
  }
  return groups;
}

function EntriesSkeleton() {
  return (
    <div className="entries-skeleton" aria-busy="true" aria-label="Loading entries">
      <div className="entries-skeleton-row" />
      <div className="entries-skeleton-row" />
      <div className="entries-skeleton-row" />
      <div className="entries-skeleton-row" />
    </div>
  );
}

export default function MyEntriesPage() {
  const { token, isAdmin } = useAuth();
  const [periods, setPeriods] = useState([]);
  const [selectedPayPeriodId, setSelectedPayPeriodId] = useState('');
  const [entries, setEntries] = useState([]);
  const [scope, setScope] = useState('own');
  const [periodsLoading, setPeriodsLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(null);

  const selectedPeriod = useMemo(
    () => periods.find((period) => period.id === selectedPayPeriodId) || null,
    [periods, selectedPayPeriodId]
  );

  const groupedEntries = useMemo(() => groupEntriesByDate(entries), [entries]);

  useEffect(() => {
    async function loadPeriods() {
      setPeriodsLoading(true);
      setError('');
      try {
        const data = await apiGet('/api/payroll/pay-periods', token);
        const nextPeriods = data.periods || [];
        setPeriods(nextPeriods);

        const current =
          nextPeriods.find((period) => period.isCurrent) || nextPeriods[0] || null;
        setSelectedPayPeriodId((existing) => {
          if (existing && nextPeriods.some((period) => period.id === existing)) {
            return existing;
          }
          return current?.id || '';
        });
      } catch (err) {
        setError(err.message || 'Failed to load pay periods');
        setPeriods([]);
        setSelectedPayPeriodId('');
      } finally {
        setPeriodsLoading(false);
      }
    }
    loadPeriods();
  }, [token]);

  useEffect(() => {
    if (!token || !selectedPeriod) {
      setEntries([]);
      return undefined;
    }

    let cancelled = false;

    async function loadEntries() {
      setLoading(true);
      setError('');
      try {
        const params = new URLSearchParams({
          periodStart: selectedPeriod.startDate || selectedPeriod.start_date,
          periodEnd: selectedPeriod.endDate || selectedPeriod.end_date,
        });
        const data = await apiGet(`/api/summary/my-entries?${params.toString()}`, token);
        if (cancelled) return;

        setEntries(data.entries || []);
        setScope(data.scope || 'own');
      } catch (err) {
        if (cancelled) return;
        setError(err.message || 'Failed to load entries');
        setEntries([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadEntries();
    return () => {
      cancelled = true;
    };
  }, [token, selectedPeriod]);

  async function handleDownloadCsv() {
    if (!selectedPayPeriodId || downloading) return;
    setDownloading(true);
    setDownloadError(null);
    try {
      const res = await fetch(
        `${API_BASE_URL}/api/daily-entries/export?payPeriodId=${encodeURIComponent(selectedPayPeriodId)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const result = await downloadFile(
        blob,
        `my-entries-${selectedPayPeriodId}.csv`,
        'text/csv'
      );
      if (!result.success && !result.cancelled) {
        setDownloadError('Failed to download entries. Please try again.');
      }
    } catch {
      setDownloadError('Failed to download entries. Please try again.');
    } finally {
      setDownloading(false);
    }
  }

  if (periodsLoading) {
    return <p>Loading…</p>;
  }

  return (
    <div>
      <header className="page-header">
        <h1>My Entries</h1>
        <p>
          {isAdmin || scope === 'all'
            ? 'All daily time entries for the selected pay period.'
            : 'Entries you personally created for the selected pay period.'}
        </p>
      </header>

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: '0.75rem',
        }}
      >
        <PayPeriodSelector
          periods={periods}
          selectedPayPeriodId={selectedPayPeriodId}
          onChange={setSelectedPayPeriodId}
        />
        {isAdmin && (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleDownloadCsv}
            disabled={downloading || !entries.length}
          >
            {downloading ? 'Preparing…' : 'Download CSV'}
          </button>
        )}
      </div>

      {downloadError && <p className="alert alert-error">{downloadError}</p>}
      {error && <p className="alert alert-error">{error}</p>}

      {loading && <EntriesSkeleton />}

      {!loading && entries.length === 0 && !error && (
        <div className="entries-empty">
          <p style={{ margin: '0 0 var(--space-3)' }}>
            No time entries for this pay period yet.
          </p>
          <Link to="/daily-entry" className="btn btn-primary">
            Go to Daily Entry
          </Link>
        </div>
      )}

      {!loading && entries.length > 0 && (
        <div className="entries-table-wrapper">
          <table className="entries-table">
            <thead>
              <tr>
                <th>Worker</th>
                <th>Job Site</th>
                <th>Pay Code</th>
                <th className="text-right">Hours</th>
                <th className="text-right">Reimbursement</th>
              </tr>
            </thead>
            <tbody>
              {groupedEntries.map((group) => (
                <Fragment key={`date-${group.date}`}>
                  <tr className="entries-date-group">
                    <td colSpan={5}>{formatDateHeading(group.date)}</td>
                  </tr>
                  {group.entries.map((entry) => {
                    const hours = Number(entry.hours);
                    const reimb = Number(entry.reimbursement_amount);
                    const isCorrection =
                      (Number.isFinite(hours) && hours < 0) ||
                      (Number.isFinite(reimb) && reimb < 0);
                    const reimburse = isReimbursementEntry(entry);
                    return (
                      <tr key={entry.id}>
                        <td>{formatWorkerName(entry)}</td>
                        <td>{entry.job_site_name || '—'}</td>
                        <td>
                          <span
                            className={`pay-code-badge${reimburse ? ' is-reimburse' : ''}`}
                          >
                            {formatPayCodeLabel(entry)}
                          </span>
                        </td>
                        <td className={`text-right${isCorrection && hours < 0 ? ' is-correction' : ''}`}>
                          {formatHoursValue(entry)}
                          {isCorrection && hours < 0 ? ' (correction)' : ''}
                        </td>
                        <td className={`text-right${isCorrection && reimb < 0 ? ' is-correction' : ''}`}>
                          {formatReimbValue(entry)}
                          {isCorrection && reimb < 0 ? ' (correction)' : ''}
                        </td>
                      </tr>
                    );
                  })}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
