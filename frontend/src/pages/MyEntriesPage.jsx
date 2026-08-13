import { useState, useEffect, useMemo, Fragment } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useEditLock } from '../context/EditLockContext';
import { apiGet, apiDelete, apiPatch, API_BASE_URL } from '../api/client';
import PayPeriodSelector from '../components/PayPeriodSelector';
import { downloadFile } from '../utils/downloadFile';

const BASE_EDIT_PAY_CODES = [
  { id: 'REGULAR', label: 'Hours' },
  { id: 'REIMBURSE', label: 'Reimbursement' },
];

const HOURS_PAY_CODES = new Set(['REGULAR', 'OT', 'DT', 'PTO']);

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

function isHoursPayCode(code) {
  return HOURS_PAY_CODES.has(String(code || '').toUpperCase());
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

function formatDateWorked(dateStr) {
  const raw = String(dateStr || '').split('T')[0];
  const [year, month, day] = raw.split('-');
  if (!year || !month || !day) return '—';
  return `${month}/${day}/${year}`;
}

function payCodeOptionsForEntry(entry) {
  const options = [...BASE_EDIT_PAY_CODES];
  const current = String(entry.pay_code || '').trim();
  if (current && !options.some((option) => option.id === current)) {
    options.push({ id: current, label: formatPayCodeLabel(entry) });
  }
  return options;
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

function emptyEditDraft() {
  return { hours: '', payCode: '', reimbursement: '' };
}

export default function MyEntriesPage() {
  const { token, isAdmin } = useAuth();
  const { readOnly, editingUser } = useEditLock();
  const [periods, setPeriods] = useState([]);
  const [selectedPayPeriodId, setSelectedPayPeriodId] = useState('');
  const [entries, setEntries] = useState([]);
  const [scope, setScope] = useState('own');
  const [periodsLoading, setPeriodsLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(null);
  const [deletingId, setDeletingId] = useState('');
  const [savingId, setSavingId] = useState('');
  const [editingId, setEditingId] = useState('');
  const [editDraft, setEditDraft] = useState(emptyEditDraft);
  const [entriesRefresh, setEntriesRefresh] = useState(0);

  const selectedPeriod = useMemo(
    () => periods.find((period) => period.id === selectedPayPeriodId) || null,
    [periods, selectedPayPeriodId]
  );

  const groupedEntries = useMemo(() => groupEntriesByDate(entries), [entries]);
  const colSpan = isAdmin ? 7 : 6;
  const canMutate = isAdmin && !readOnly;
  const editPayCodeIsHours = isHoursPayCode(editDraft.payCode);

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
    let cancelled = false;
    (async () => {
      if (!token || !selectedPeriod) {
        setEntries([]);
        return;
      }
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
    })();
    return () => {
      cancelled = true;
    };
  }, [token, selectedPeriod, entriesRefresh]);

  function startEdit(entry) {
    if (!canMutate) return;
    setError('');
    setEditingId(entry.id);
    setEditDraft({
      hours: entry.hours != null && entry.hours !== '' ? String(entry.hours) : '',
      payCode: entry.pay_code || 'REGULAR',
      reimbursement:
        entry.reimbursement_amount != null && entry.reimbursement_amount !== ''
          ? String(entry.reimbursement_amount)
          : '',
    });
  }

  function cancelEdit() {
    setEditingId('');
    setEditDraft(emptyEditDraft());
    setSavingId('');
  }

  async function saveEdit(entry) {
    if (!canMutate || !entry?.id) return;
    setError('');

    const hoursValue = Number(editDraft.hours);
    const reimbValue = Number(editDraft.reimbursement);
    const nextIsHours = isHoursPayCode(editDraft.payCode);

    if (!editDraft.payCode) {
      setError('Pay code is required');
      return;
    }
    if (nextIsHours) {
      if (!editDraft.hours || hoursValue === 0 || Number.isNaN(hoursValue)) {
        setError('Hours must be a non-zero value');
        return;
      }
    } else if (
      !editDraft.reimbursement ||
      reimbValue === 0 ||
      Number.isNaN(reimbValue)
    ) {
      setError('Reimbursement amount must be a non-zero value');
      return;
    }

    setSavingId(entry.id);
    try {
      const updated = await apiPatch(
        `/api/entries/${entry.id}`,
        {
          payCode: editDraft.payCode,
          hours: nextIsHours ? hoursValue : 0,
          reimbursementAmount: nextIsHours ? 0 : reimbValue,
        },
        token
      );
      setEntries((prev) =>
        prev.map((row) =>
          row.id === entry.id
            ? {
                ...row,
                ...updated,
                hours: updated.hours ?? updated.hours_worked,
                entry_date: updated.entry_date || updated.date_worked || row.entry_date,
                worker_first_name: row.worker_first_name,
                worker_last_name: row.worker_last_name,
                job_site_name: row.job_site_name,
              }
            : row
        )
      );
      cancelEdit();
    } catch (err) {
      setError(err.message || 'Failed to update entry');
    } finally {
      setSavingId('');
    }
  }

  async function handleDeleteEntry(entry) {
    if (!canMutate || !entry?.id) return;
    const worker = formatWorkerName(entry);
    const dateLabel = formatDateHeading(entry.entry_date);
    if (
      !window.confirm(
        `Delete this entry for ${worker} on ${dateLabel}? This cannot be undone.`
      )
    ) {
      return;
    }
    setDeletingId(entry.id);
    setError('');
    try {
      await apiDelete(`/api/entries/${entry.id}`, token);
      setEntries((prev) => prev.filter((row) => row.id !== entry.id));
      if (editingId === entry.id) cancelEdit();
    } catch (err) {
      setError(err.message || 'Failed to delete entry');
      setEntriesRefresh((n) => n + 1);
    } finally {
      setDeletingId('');
    }
  }
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
      {isAdmin && readOnly && (
        <p className="alert alert-error">
          Read-only: {editingUser?.name || 'another user'} currently has edit rights.
        </p>
      )}

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
                <th>Date Worked</th>
                <th>Worker</th>
                <th>Job Site</th>
                <th>Pay Code</th>
                <th className="text-right">Hours</th>
                <th className="text-right">Reimbursement</th>
                {isAdmin ? <th className="text-right">Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {groupedEntries.map((group) => (
                <Fragment key={`date-${group.date}`}>
                  <tr className="entries-date-group">
                    <td colSpan={colSpan}>{formatDateHeading(group.date)}</td>
                  </tr>
                  {group.entries.map((entry) => {
                    const hours = Number(entry.hours);
                    const reimb = Number(entry.reimbursement_amount);
                    const isCorrection =
                      (Number.isFinite(hours) && hours < 0) ||
                      (Number.isFinite(reimb) && reimb < 0);
                    const reimburse = isReimbursementEntry(entry);
                    const isEditing = editingId === entry.id;
                    return (
                      <tr key={entry.id}>
                        <td>{formatDateWorked(entry.entry_date)}</td>
                        <td>{formatWorkerName(entry)}</td>
                        <td>{entry.job_site_name || '—'}</td>
                        <td>
                          {isEditing ? (
                            <select
                              value={editDraft.payCode}
                              onChange={(e) =>
                                setEditDraft((draft) => ({
                                  ...draft,
                                  payCode: e.target.value,
                                }))
                              }
                            >
                              {payCodeOptionsForEntry(entry).map((option) => (
                                <option key={option.id} value={option.id}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span
                              className={`pay-code-badge${reimburse ? ' is-reimburse' : ''}`}
                            >
                              {formatPayCodeLabel(entry)}
                            </span>
                          )}
                        </td>
                        <td className={`text-right${isCorrection && hours < 0 ? ' is-correction' : ''}`}>
                          {isEditing && editPayCodeIsHours ? (
                            <input
                              type="number"
                              step="0.5"
                              value={editDraft.hours}
                              onChange={(e) =>
                                setEditDraft((draft) => ({
                                  ...draft,
                                  hours: e.target.value,
                                }))
                              }
                              style={{ maxWidth: 88, textAlign: 'right' }}
                            />
                          ) : (
                            <>
                              {formatHoursValue(entry)}
                              {isCorrection && hours < 0 ? ' (correction)' : ''}
                            </>
                          )}
                        </td>
                        <td className={`text-right${isCorrection && reimb < 0 ? ' is-correction' : ''}`}>
                          {isEditing && !editPayCodeIsHours ? (
                            <input
                              type="number"
                              step="0.01"
                              value={editDraft.reimbursement}
                              onChange={(e) =>
                                setEditDraft((draft) => ({
                                  ...draft,
                                  reimbursement: e.target.value,
                                }))
                              }
                              style={{ maxWidth: 96, textAlign: 'right' }}
                            />
                          ) : (
                            <>
                              {formatReimbValue(entry)}
                              {isCorrection && reimb < 0 ? ' (correction)' : ''}
                            </>
                          )}
                        </td>
                        {isAdmin ? (
                          <td className="text-right">
                            {canMutate && isEditing ? (
                              <div className="inline-actions" style={{ justifyContent: 'flex-end' }}>
                                <button
                                  type="button"
                                  className="btn btn-primary btn-sm"
                                  disabled={savingId === entry.id}
                                  onClick={() => saveEdit(entry)}
                                >
                                  {savingId === entry.id ? 'Saving…' : 'Save'}
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-secondary btn-sm"
                                  disabled={savingId === entry.id}
                                  onClick={cancelEdit}
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : canMutate ? (
                              <div className="inline-actions" style={{ justifyContent: 'flex-end' }}>
                                <button
                                  type="button"
                                  className="btn btn-secondary btn-sm"
                                  disabled={Boolean(editingId) || deletingId === entry.id}
                                  onClick={() => startEdit(entry)}
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-secondary btn-sm"
                                  disabled={Boolean(editingId) || deletingId === entry.id}
                                  onClick={() => handleDeleteEntry(entry)}
                                >
                                  {deletingId === entry.id ? 'Deleting…' : 'Delete'}
                                </button>
                              </div>
                            ) : (
                              <span className="form-hint">Read-only</span>
                            )}
                          </td>
                        ) : null}
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
