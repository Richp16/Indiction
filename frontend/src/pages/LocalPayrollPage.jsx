import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useEditLock } from '../context/EditLockContext';
import { apiGet, apiGetDownload, apiPost } from '../api/client';
import TimeEntryImportPanel from '../components/TimeEntryImportPanel';

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

function formatCurrency(value) {
  return currencyFormatter.format(Number.isFinite(Number(value)) ? Number(value) : 0);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function LocalPayrollPage() {
  const { token } = useAuth();
  const { isLockHolder, acquireLock, readOnly } = useEditLock();
  const [periods, setPeriods] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [review, setReview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [importKey, setImportKey] = useState(0);

  const selectedPeriod = useMemo(
    () => periods.find((p) => p.id === selectedId) || null,
    [periods, selectedId]
  );

  const loadPeriods = useCallback(async () => {
    const data = await apiGet('/api/local-payroll/pay-periods', token);
    const next = data.periods || [];
    setPeriods(next);
    setSelectedId((existing) => {
      if (existing && next.some((p) => p.id === existing)) return existing;
      return next.find((p) => p.isCurrent)?.id || next[0]?.id || '';
    });
  }, [token]);

  const loadReview = useCallback(async (payPeriodId) => {
    if (!payPeriodId) {
      setReview(null);
      return;
    }
    const data = await apiGet(`/api/local-payroll/${payPeriodId}/review`, token);
    setReview(data);
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        await loadPeriods();
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadPeriods, importKey]);

  useEffect(() => {
    if (!selectedId) {
      setReview(null);
      return undefined;
    }
    let cancelled = false;
    loadReview(selectedId).catch((err) => {
      if (!cancelled) setError(err.message);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedId, loadReview, importKey]);

  async function ensureLock() {
    if (!isLockHolder) await acquireLock();
  }

  async function exportCsv() {
    if (!selectedId) return;
    const { blob, filename } = await apiGetDownload(
      `/api/local-payroll/${selectedId}/export.csv`,
      token
    );
    downloadBlob(blob, filename);
    setMessage(`Downloaded ${filename}`);
  }

  async function markExported() {
    await ensureLock();
    await apiPost(`/api/local-payroll/${selectedId}/mark-exported`, {}, token);
    setMessage('Period marked as exported');
    await loadPeriods();
    await loadReview(selectedId);
  }

  async function finalize() {
    if (!window.confirm('Close this pay period? New entries for this period will still resolve by date, but the period will show as CLOSED.')) {
      return;
    }
    await ensureLock();
    await apiPost(`/api/local-payroll/${selectedId}/finalize`, {}, token);
    setMessage('Period finalized (CLOSED)');
    await loadPeriods();
    await loadReview(selectedId);
  }

  async function reopen() {
    if (!window.confirm('Reopen this closed pay period? Confirm you intend to edit finalized payroll data.')) {
      return;
    }
    await ensureLock();
    await apiPost(`/api/local-payroll/${selectedId}/reopen`, { confirm: true }, token);
    setMessage('Period reopened');
    await loadPeriods();
    await loadReview(selectedId);
  }

  return (
    <div>
      <h1>Local Payroll</h1>
      <p>
        Review hours and gross pay for a local pay period, export a provider-neutral CSV,
        then mark the run exported or closed. This is <strong>not</strong> Paychex SPI —
        use it with your payroll/accounting provider.
      </p>
      <p style={{ fontSize: 14, color: '#64748b' }}>
        Indiction does not calculate or file payroll taxes. Withholding on Certified Payroll
        should come from your company&apos;s payroll records.
      </p>

      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      {message && <p style={{ color: '#15803d' }}>{message}</p>}
      {loading && <p>Loading…</p>}

      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem', alignItems: 'center' }}>
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          aria-label="Pay period"
        >
          <option value="">Select pay period</option>
          {periods.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label} ({p.status || 'OPEN'})
            </option>
          ))}
        </select>
        <Link to="/admin/employees">Manage employees &amp; periods</Link>
        <Link to="/certified-payroll">Certified Payroll</Link>
      </div>

      <TimeEntryImportPanel
        token={token}
        onCommitted={() => setImportKey((k) => k + 1)}
      />

      {review && (
        <>
          <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
            <div>
              <strong>Hours</strong>
              <div>{review.companyTotals.hours}</div>
            </div>
            <div>
              <strong>Gross</strong>
              <div>{formatCurrency(review.companyTotals.gross)}</div>
            </div>
            <div>
              <strong>Reimbursements</strong>
              <div>{formatCurrency(review.companyTotals.reimbursements)}</div>
            </div>
            <div>
              <strong>Total</strong>
              <div>{formatCurrency(review.companyTotals.total)}</div>
            </div>
            <div>
              <strong>Status</strong>
              <div>
                {review.payPeriod.status}
                {review.payPeriod.exportedAt ? ' · exported' : ''}
              </div>
            </div>
          </div>

          {review.issues?.length > 0 && (
            <div style={{ background: '#fef3c7', padding: '0.75rem', marginBottom: '1rem' }}>
              <strong>
                {review.blockingIssueCount} blocking · {review.issues.length} issue(s)
              </strong>
              <ul>
                {review.issues.slice(0, 12).map((issue, idx) => (
                  <li key={`${issue.workerId}-${idx}`}>{issue.message}</li>
                ))}
              </ul>
            </div>
          )}

          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
            <button type="button" onClick={() => exportCsv().catch((e) => setError(e.message))}>
              Export CSV
            </button>
            <button
              type="button"
              disabled={readOnly}
              onClick={() => markExported().catch((e) => setError(e.message))}
            >
              Mark exported
            </button>
            {selectedPeriod?.status !== 'CLOSED' ? (
              <button
                type="button"
                disabled={readOnly}
                onClick={() => finalize().catch((e) => setError(e.message))}
              >
                Finalize / close
              </button>
            ) : (
              <button
                type="button"
                disabled={readOnly}
                onClick={() => reopen().catch((e) => setError(e.message))}
              >
                Reopen period
              </button>
            )}
          </div>

          <h2>Line items</h2>
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Code</th>
                  <th>Job</th>
                  <th>Pay code</th>
                  <th>Hours</th>
                  <th>Rate</th>
                  <th>Amount</th>
                  <th>Reimb.</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {review.rows.map((row, idx) => (
                  <tr key={`${row.workerId}-${row.payCode}-${row.jobCode}-${idx}`}>
                    <td>
                      {row.lastName}, {row.firstName}
                      {!row.isActive ? ' (inactive)' : ''}
                    </td>
                    <td>{row.employeeCode || '—'}</td>
                    <td>{row.jobCode || '—'}</td>
                    <td>{row.payCode}</td>
                    <td>{row.hours}</td>
                    <td style={{ color: row.rateMissing ? 'crimson' : undefined }}>
                      {row.rate != null ? formatCurrency(row.rate) : '—'}
                    </td>
                    <td>{formatCurrency(row.amount)}</td>
                    <td>{formatCurrency(row.reimbursementAmount)}</td>
                    <td>{formatCurrency(row.totalGross)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
