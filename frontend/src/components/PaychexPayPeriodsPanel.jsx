import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPost } from '../api/client';

function formatDate(value) {
  if (!value) return '—';
  return String(value).split('T')[0];
}

/**
 * Admin UI: sync + select Paychex pay periods for checks.
 *
 * Data source: GET /api/paychex/companies/:id/pay-periods → `paychex_pay_periods`
 * only (synced COMPLETED catalog). Does not use operational `pay_periods` /
 * Payroll page periods.
 */
export default function PaychexPayPeriodsPanel({ token }) {
  const [companyId, setCompanyId] = useState('');
  const [periods, setPeriods] = useState([]);
  const [selectedPayPeriodId, setSelectedPayPeriodId] = useState('');
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [checksPreview, setChecksPreview] = useState(null);
  const [loadingChecks, setLoadingChecks] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const loadPeriods = useCallback(
    async (cid) => {
      if (!token || !cid) return;
      const data = await apiGet(`/api/paychex/companies/${cid}/pay-periods`, token);
      setPeriods(data.periods || []);
      setSelectedPayPeriodId((current) => {
        if (current && (data.periods || []).some((p) => p.payPeriodId === current)) {
          return current;
        }
        return data.periods?.[0]?.payPeriodId || '';
      });
    },
    [token]
  );

  useEffect(() => {
    if (!token) return undefined;
    let cancelled = false;

    async function init() {
      setLoading(true);
      setError('');
      try {
        const company = await apiGet('/api/paychex/company', token);
        if (cancelled) return;
        setCompanyId(company.companyId);
        await loadPeriods(company.companyId);
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load Paychex company');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    init();
    return () => {
      cancelled = true;
    };
  }, [token, loadPeriods]);

  async function handleSync() {
    if (!companyId) return;
    setSyncing(true);
    setError('');
    setMessage('');
    setChecksPreview(null);
    try {
      const summary = await apiPost(
        `/api/paychex/companies/${companyId}/pay-periods/sync`,
        { statuses: ['COMPLETED'] },
        token
      );
      setMessage(
        `Synced ${summary.fetchedCount} periods ` +
          `(${summary.insertedCount} new, ${summary.updatedCount} updated)`
      );
      await loadPeriods(companyId);
    } catch (err) {
      setError(err.message || 'Pay period sync failed');
    } finally {
      setSyncing(false);
    }
  }

  async function handleReconcile() {
    if (!companyId) return;
    setReconciling(true);
    setError('');
    setMessage('');
    try {
      const summary = await apiPost(
        `/api/paychex/companies/${companyId}/pay-periods/reconcile`,
        {},
        token
      );
      setMessage(
        `Reconciled local periods: ${summary.matched} matched, ` +
          `${summary.updated} updated, ${summary.alreadyLinked} already linked, ` +
          `${summary.unmatched} unmatched`
      );
    } catch (err) {
      setError(err.message || 'Reconcile failed');
    } finally {
      setReconciling(false);
    }
  }

  async function handleLoadCompanyChecks() {
    if (!companyId || !selectedPayPeriodId) return;
    setLoadingChecks(true);
    setError('');
    setChecksPreview(null);
    try {
      const data = await apiGet(
        `/api/paychex/companies/${companyId}/checks?payPeriodId=${encodeURIComponent(selectedPayPeriodId)}`,
        token
      );
      setChecksPreview({
        type: 'company',
        count: data.count,
        payPeriodId: data.payPeriodId,
        sample: data.checks?.[0] || null,
      });
    } catch (err) {
      if (/Unknown payPeriodId/i.test(err.message || '')) {
        setError(
          'This pay period is not available locally. Re-sync Paychex pay periods.'
        );
      } else {
        setError(err.message || 'Failed to load company checks');
      }
    } finally {
      setLoadingChecks(false);
    }
  }

  const selected = periods.find((p) => p.payPeriodId === selectedPayPeriodId) || null;

  if (loading) {
    return <p>Loading Paychex pay periods…</p>;
  }

  return (
    <section style={{ marginBottom: '2rem' }}>
      <h2>Paychex Pay Periods</h2>
      {companyId && (
        <p style={{ color: '#555', marginBottom: '0.75rem' }}>
          Company: <code>{companyId}</code>
        </p>
      )}

      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      {message && <p style={{ color: 'green' }}>{message}</p>}

      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <button type="button" onClick={handleSync} disabled={syncing || !companyId}>
          {syncing ? 'Syncing…' : 'Sync Paychex Pay Periods'}
        </button>
        <button
          type="button"
          onClick={handleReconcile}
          disabled={reconciling || !companyId}
        >
          {reconciling ? 'Reconciling…' : 'Reconcile Paychex pay periods'}
        </button>
        <button
          type="button"
          onClick={handleLoadCompanyChecks}
          disabled={loadingChecks || !selectedPayPeriodId}
        >
          {loadingChecks ? 'Loading checks…' : 'Preview company checks'}
        </button>
      </div>

      {periods.length === 0 ? (
        <div
          style={{
            padding: '1.25rem',
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: 6,
          }}
        >
          <p style={{ marginTop: 0 }}>No Paychex pay periods stored locally yet.</p>
          <button type="button" onClick={handleSync} disabled={syncing || !companyId}>
            {syncing ? 'Syncing…' : 'Sync Paychex Pay Periods'}
          </button>
        </div>
      ) : (
        <>
          <label style={{ display: 'block', marginBottom: '0.5rem' }}>
            Selected pay period
            <select
              value={selectedPayPeriodId}
              onChange={(e) => {
                setSelectedPayPeriodId(e.target.value);
                setChecksPreview(null);
                setError('');
              }}
              style={{ display: 'block', marginTop: 4, minWidth: 320 }}
            >
              {periods.map((period) => (
                <option key={period.payPeriodId} value={period.payPeriodId}>
                  {(period.description || period.payPeriodId) +
                    ` · ${formatDate(period.startDate)} → ${formatDate(period.endDate)}` +
                    (period.status ? ` · ${period.status}` : '')}
                </option>
              ))}
            </select>
          </label>

          {selected && (
            <dl
              style={{
                display: 'grid',
                gridTemplateColumns: '140px 1fr',
                gap: '0.35rem 1rem',
                background: '#f8fafc',
                padding: '0.75rem 1rem',
                borderRadius: 6,
              }}
            >
              <dt>Description</dt>
              <dd style={{ margin: 0 }}>{selected.description || '—'}</dd>
              <dt>Interval</dt>
              <dd style={{ margin: 0 }}>{selected.intervalCode || '—'}</dd>
              <dt>Status</dt>
              <dd style={{ margin: 0 }}>{selected.status || '—'}</dd>
              <dt>Start</dt>
              <dd style={{ margin: 0 }}>{formatDate(selected.startDate)}</dd>
              <dt>End</dt>
              <dd style={{ margin: 0 }}>{formatDate(selected.endDate)}</dd>
              <dt>Check date</dt>
              <dd style={{ margin: 0 }}>{formatDate(selected.checkDate)}</dd>
              <dt>Check count</dt>
              <dd style={{ margin: 0 }}>
                {selected.checkCount != null ? selected.checkCount : '—'}
              </dd>
              <dt>Paychex ID</dt>
              <dd style={{ margin: 0 }}>
                <code>{selected.payPeriodId}</code>
              </dd>
            </dl>
          )}

          <div style={{ marginTop: '1rem', overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 14 }}>
              <thead>
                <tr>
                  <th style={thStyle}>Description</th>
                  <th style={thStyle}>Interval</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}>Start</th>
                  <th style={thStyle}>End</th>
                  <th style={thStyle}>Check date</th>
                  <th style={thStyle}>Checks</th>
                  <th style={thStyle}>payPeriodId</th>
                </tr>
              </thead>
              <tbody>
                {periods.map((period) => (
                  <tr
                    key={period.payPeriodId}
                    style={
                      period.payPeriodId === selectedPayPeriodId
                        ? { background: '#eff6ff' }
                        : undefined
                    }
                  >
                    <td style={tdStyle}>{period.description || '—'}</td>
                    <td style={tdStyle}>{period.intervalCode || '—'}</td>
                    <td style={tdStyle}>{period.status || '—'}</td>
                    <td style={tdStyle}>{formatDate(period.startDate)}</td>
                    <td style={tdStyle}>{formatDate(period.endDate)}</td>
                    <td style={tdStyle}>{formatDate(period.checkDate)}</td>
                    <td style={tdStyle}>
                      {period.checkCount != null ? period.checkCount : '—'}
                    </td>
                    <td style={tdStyle}>
                      <code>{period.payPeriodId}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {checksPreview && (
        <pre
          style={{
            marginTop: '1rem',
            background: '#f5f5f5',
            padding: '1rem',
            overflow: 'auto',
            maxHeight: 280,
          }}
        >
          {JSON.stringify(checksPreview, null, 2)}
        </pre>
      )}
    </section>
  );
}

const thStyle = {
  textAlign: 'left',
  borderBottom: '1px solid #ddd',
  padding: '6px 8px',
  whiteSpace: 'nowrap',
};

const tdStyle = {
  borderBottom: '1px solid #eee',
  padding: '6px 8px',
  verticalAlign: 'top',
};
