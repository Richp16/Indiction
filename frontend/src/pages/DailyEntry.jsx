import { useState, useEffect, useRef, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { useEditLock } from '../context/EditLockContext';
import { apiGet, apiPost } from '../api/client';
import WorkerSearch from '../components/WorkerSearch';

const BASE_PAY_CODES = [
  { id: 'REGULAR', label: 'Hours', type: 'HOURS' },
];

const GENERIC_REIMBURSE_CODE = {
  id: 'REIMBURSE',
  label: 'Reimbursement',
  type: 'REIMBURSEMENT',
};

function getToday() {
  return new Date().toISOString().split('T')[0];
}

/** Sunday–Saturday containing dateStr (UTC), matching backend getWeekBounds. */
function getWeekBoundsClient(dateStr) {
  const date = new Date(`${dateStr}T12:00:00Z`);
  const day = date.getUTCDay();
  const sunday = new Date(date);
  sunday.setUTCDate(date.getUTCDate() - day);
  const saturday = new Date(sunday);
  saturday.setUTCDate(sunday.getUTCDate() + 6);
  return {
    sunday: sunday.toISOString().split('T')[0],
    saturday: saturday.toISOString().split('T')[0],
  };
}

function formatWeekdayDate(dateStr) {
  const date = new Date(`${dateStr}T12:00:00`);
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function remainingOtColor(remaining) {
  if (remaining === 0) return '#dc2626';
  if (remaining <= 8) return '#b45309';
  return '#15803d';
}

function formatDateShort(dateStr) {
  const raw = String(dateStr || '').split('T')[0];
  const [year, month, day] = raw.split('-');
  if (!year || !month || !day) return dateStr || '—';
  return `${month}/${day}/${year}`;
}

function workerDisplayName(worker) {
  return `${worker.firstName || ''} ${worker.lastName || ''}`.trim() || 'Unknown worker';
}

export default function DailyEntry() {
  const { token, isAdmin } = useAuth();
  const { readOnly, editingUser } = useEditLock();

  const [period, setPeriod] = useState(null);
  const [jobSites, setJobSites] = useState([]);
  const [selectedJobSiteId, setSelectedJobSiteId] = useState('');
  const [searchText, setSearchText] = useState('');
  const [workerResults, setWorkerResults] = useState([]);
  const [selectedWorker, setSelectedWorker] = useState(null);
  const [selectedPayCodeId, setSelectedPayCodeId] = useState('');
  const [entryDate, setEntryDate] = useState(getToday());
  const [hours, setHours] = useState('');
  const [reimbursement, setReimbursement] = useState('');
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedMessage, setSavedMessage] = useState('');
  const [weeklyHours, setWeeklyHours] = useState(null);
  const [weeklyHoursLoading, setWeeklyHoursLoading] = useState(false);
  const [weeklyHoursRefresh, setWeeklyHoursRefresh] = useState(0);
  const [paychexRecurringReimb, setPaychexRecurringReimb] = useState(null);
  const [bulkMode, setBulkMode] = useState(false);
  const [selectedWorkers, setSelectedWorkers] = useState([]);
  const [bulkConfirming, setBulkConfirming] = useState(false);
  const [bulkResult, setBulkResult] = useState(null);
  const debounceRef = useRef(null);

  const payCodes = [...BASE_PAY_CODES, GENERIC_REIMBURSE_CODE];
  const selectedPayCode = payCodes.find((code) => code.id === selectedPayCodeId);
  const isReimbursementEntry = selectedPayCode?.type === 'REIMBURSEMENT';

  const currentWeekBounds = useMemo(() => getWeekBoundsClient(getToday()), []);

  useEffect(() => {
    async function loadInitial() {
      setLoading(true);
      setError('');
      try {
        const [periodData, sitesData] = await Promise.all([
          apiGet('/api/pay-periods/current', token),
          apiGet('/api/job-sites', token),
        ]);
        setPeriod(periodData);
        setJobSites((sitesData || []).filter((site) => site.is_active !== false));

        if (!isAdmin) {
          const today = getToday();
          const { sunday, saturday } = getWeekBoundsClient(today);
          if (today < sunday || today > saturday) {
            setEntryDate(sunday);
          } else {
            setEntryDate(today);
          }
        }
      } catch (err) {
        setError(err.message || 'Failed to load page data');
      } finally {
        setLoading(false);
      }
    }
    loadInitial();
  }, [token, isAdmin]);

  // Admins: resolve pay period for the selected work date (supports past periods).
  useEffect(() => {
    if (!isAdmin || !token || !entryDate) return undefined;

    let cancelled = false;
    async function loadPeriodForDate() {
      try {
        const periodData = await apiGet(
          `/api/pay-periods/for-date?date=${encodeURIComponent(entryDate)}`,
          token
        );
        if (!cancelled) {
          setPeriod(periodData);
          setError('');
        }
      } catch (err) {
        if (!cancelled) {
          setPeriod(null);
          setError(err.message || 'Selected date is not in a defined pay period');
        }
      }
    }
    loadPeriodForDate();
    return () => {
      cancelled = true;
    };
  }, [isAdmin, token, entryDate]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!searchText.trim()) {
      setWorkerResults([]);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const workers = await apiGet(
          `/api/workers?search=${encodeURIComponent(searchText.trim())}`,
          token
        );
        const activePaidWorkers = workers.filter(
          (w) => w.isActive !== false && w.standardRate != null
        );
        setWorkerResults(activePaidWorkers);
      } catch {
        setWorkerResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchText, token]);

  useEffect(() => {
    if (readOnly && bulkMode) {
      setBulkMode(false);
      setBulkConfirming(false);
    }
  }, [readOnly, bulkMode]);

  useEffect(() => {
    if (bulkMode) return;
    if (!selectedWorker) {
      setSelectedPayCodeId('');
      setPaychexRecurringReimb(null);
    }
  }, [selectedWorker, bulkMode]);

  useEffect(() => {
    if (!isAdmin || bulkMode || !selectedWorker || !token) {
      if (!selectedWorker || bulkMode) setPaychexRecurringReimb(null);
      return undefined;
    }

    let cancelled = false;

    async function loadRecurringReimbursements() {
      try {
        const data = await apiGet(
          `/api/workers/${selectedWorker.id}/recurring-reimbursements`,
          token
        );
        if (!cancelled) {
          setPaychexRecurringReimb(data);
        }
      } catch {
        if (!cancelled) {
          setPaychexRecurringReimb(null);
        }
      }
    }

    loadRecurringReimbursements();
    return () => {
      cancelled = true;
    };
  }, [isAdmin, selectedWorker, token, bulkMode]);

  useEffect(() => {
    if (bulkMode || !selectedWorker || !period) {
      if (bulkMode || !selectedWorker) setWeeklyHours(null);
      return;
    }

    async function fetchWeeklyHours() {
      setWeeklyHoursLoading(true);
      try {
        const data = await apiGet(
          `/api/workers/${selectedWorker.id}/weekly-hours` +
            `?date=${entryDate}&payPeriodId=${period.id}`,
          token
        );
        setWeeklyHours(data);
      } catch {
        setWeeklyHours(null);
      } finally {
        setWeeklyHoursLoading(false);
      }
    }

    fetchWeeklyHours();
  }, [selectedWorker, entryDate, period, token, weeklyHoursRefresh, bulkMode]);

  function selectWorker(worker) {
    setSelectedWorker(worker);
    setSearchText(`${worker.firstName} ${worker.lastName}`);
    setWorkerResults([]);
    setSelectedPayCodeId('');
  }

  function toggleBulkMode() {
    if (readOnly) return;
    setError('');
    setSavedMessage('');
    setBulkResult(null);
    setBulkConfirming(false);
    setBulkMode((value) => {
      const next = !value;
      if (next) {
        setSelectedWorker(null);
        setSearchText('');
        setWorkerResults([]);
        setSelectedPayCodeId('');
      } else {
        setSelectedWorkers([]);
      }
      return next;
    });
  }

  function buildSharedPayload() {
    const jobSiteId = selectedJobSiteId || null;
    const payload = {
      jobSiteId,
      entry_date: entryDate,
      hours: isReimbursementEntry ? 0 : Number(hours) || 0,
      reimbursementAmount: isReimbursementEntry ? Number(reimbursement) : 0,
      payCode: selectedPayCodeId,
    };
    if (!isAdmin && period?.id) {
      payload.payPeriodId = period.id;
    }
    return payload;
  }

  function validateEntryForm() {
    if (readOnly) {
      setError(
        `Read-only: ${editingUser?.name || 'another user'} currently has edit rights.`
      );
      return false;
    }
    const hasWorkers = bulkMode ? selectedWorkers.length > 0 : Boolean(selectedWorker);
    if (!hasWorkers || !selectedPayCode) {
      setError('Please complete all required fields');
      return false;
    }
    if (!entryDate) {
      setError('Work Date is required');
      return false;
    }
    if (!isAdmin && !period) {
      setError('Please complete all required fields');
      return false;
    }

    if (selectedPayCode.type === 'HOURS') {
      const hoursValue = Number(hours);
      if (!hours || hoursValue === 0 || Number.isNaN(hoursValue)) {
        setError('Hours must be a non-zero value');
        return false;
      }
      if (!isAdmin && hoursValue < 0) {
        setError('Hours must be greater than zero for wage entries');
        return false;
      }
    } else {
      const reimbValue = Number(reimbursement);
      if (!reimbursement || reimbValue === 0 || Number.isNaN(reimbValue)) {
        setError('Reimbursement amount must be a non-zero value');
        return false;
      }
      if (!isAdmin && reimbValue < 0) {
        setError('Reimbursement amount must be greater than zero');
        return false;
      }
    }
    return true;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setSavedMessage('');
    setBulkResult(null);

    if (!validateEntryForm()) return;

    if (bulkMode && !bulkConfirming) {
      setBulkConfirming(true);
      return;
    }

    const payload = buildSharedPayload();
    setSaving(true);
    try {
      if (bulkMode) {
        const result = await apiPost(
          '/api/entries/bulk',
          {
            ...payload,
            workerIds: selectedWorkers.map((worker) => worker.id),
          },
          token
        );
        const nameById = Object.fromEntries(
          selectedWorkers.map((worker) => [String(worker.id), workerDisplayName(worker)])
        );
        setBulkResult({
          ...result,
          results: (result.results || []).map((row) => ({
            ...row,
            workerName: nameById[String(row.workerId)] || row.workerId,
          })),
        });
        setBulkConfirming(false);
        const created = result.createdCount || 0;
        const failed = result.failedCount || 0;
        if (failed === 0) {
          setSavedMessage(`Created ${created} ${created === 1 ? 'entry' : 'entries'}.`);
          setHours('');
          setReimbursement('');
        } else if (created === 0) {
          setError(
            `No entries were created. ${failed} ${failed === 1 ? 'worker' : 'workers'} failed.`
          );
        } else {
          setSavedMessage(
            `Created ${created} ${created === 1 ? 'entry' : 'entries'}. ${failed} failed.`
          );
        }
      } else {
        const result = await apiPost(
          '/api/entries',
          { ...payload, workerId: selectedWorker.id },
          token
        );
        setHours('');
        setReimbursement('');
        if (result?.split) {
          setSavedMessage(result.message);
        } else if (result?.correction) {
          setSavedMessage(result.message || 'Correction applied.');
        } else {
          setSavedMessage('Entry saved successfully.');
        }
        setWeeklyHoursRefresh((n) => n + 1);
      }
    } catch (err) {
      setError(err.message || 'Failed to save entry');
      setBulkConfirming(false);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p>Loading…</p>;
  }

  const dateMin = isAdmin ? undefined : currentWeekBounds.sunday;
  const dateMax = isAdmin ? undefined : currentWeekBounds.saturday;
  const hoursValue = Number(hours);
  const reimbValue = Number(reimbursement);
  const isHoursCorrection =
    isAdmin && !isReimbursementEntry && Number.isFinite(hoursValue) && hoursValue < 0;
  const isReimbCorrection =
    isAdmin && isReimbursementEntry && Number.isFinite(reimbValue) && reimbValue < 0;
  const paychexRecurringTotal = Number(paychexRecurringReimb?.totalAmount) || 0;
  const showPaychexRecurringWarning =
    isAdmin && !bulkMode && selectedWorker && paychexRecurringTotal > 0;
  const workerReady = bulkMode ? selectedWorkers.length > 0 : Boolean(selectedWorker);
  const selectedJobSite = jobSites.find((site) => site.id === selectedJobSiteId);
  const jobSiteLabel = selectedJobSite?.name || 'General / No Job Site';
  const workerNames = selectedWorkers.map(workerDisplayName);
  const quantityLabel = isReimbursementEntry
    ? `$${Number(reimbursement || 0).toFixed(2)} of ${selectedPayCode?.label || 'Reimbursement'}`
    : `${hours || 0} hours of ${selectedPayCode?.label || 'Hours'}`;
  const workerNameById = Object.fromEntries(
    selectedWorkers.map((worker) => [String(worker.id), workerDisplayName(worker)])
  );

  return (
    <div>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.75rem',
          marginBottom: '0.5rem',
        }}
      >
        <h1 style={{ margin: 0 }}>Daily Entry</h1>
        {!readOnly && (
          <button type="button" className="btn btn-secondary" onClick={toggleBulkMode}>
            {bulkMode ? 'Single Entry' : 'Bulk Entry'}
          </button>
        )}
      </div>

      {period && (
        <p>
          Pay period: {period.start_date} – {period.end_date}
        </p>
      )}

      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      {savedMessage && <p style={{ color: 'green' }}>{savedMessage}</p>}

      <form onSubmit={handleSubmit} style={{ maxWidth: bulkMode ? 560 : 480 }}>
        <div style={{ marginBottom: '1rem' }}>
          <label htmlFor="entry-date">Work Date</label>
          <input
            id="entry-date"
            type="date"
            value={entryDate}
            min={dateMin}
            max={dateMax}
            onChange={(e) => {
              setError('');
              setBulkConfirming(false);
              setEntryDate(e.target.value);
            }}
            required
            style={{ display: 'block', width: '100%', padding: '0.5rem' }}
          />
        </div>

        <div style={{ marginBottom: '1rem' }}>
          <label htmlFor="job-site">Worksite</label>
          <select
            id="job-site"
            value={selectedJobSiteId}
            onChange={(e) => {
              setBulkConfirming(false);
              setSelectedJobSiteId(e.target.value);
            }}
            style={{ display: 'block', width: '100%', padding: '0.5rem' }}
          >
            <option value="">-- General / No Job Site --</option>
            {jobSites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.name}
              </option>
            ))}
          </select>
        </div>

        {bulkMode ? (
          <div style={{ marginBottom: '1rem' }}>
            <label htmlFor="worker-search">Workers</label>
            <WorkerSearch
              multiSelect
              selectedWorkers={selectedWorkers}
              onChange={(workers) => {
                setBulkConfirming(false);
                setSelectedWorkers(workers);
              }}
              disabled={readOnly}
            />
          </div>
        ) : (
          <div style={{ marginBottom: '1rem', position: 'relative' }}>
            <label htmlFor="worker-search">Worker</label>
            <input
              id="worker-search"
              type="text"
              placeholder="Search by name…"
              value={searchText}
              onChange={(e) => {
                setSearchText(e.target.value);
                if (!e.target.value.trim()) setSelectedWorker(null);
              }}
              style={{ display: 'block', width: '100%', padding: '0.5rem' }}
            />
            {searching && <p>Searching…</p>}
            {workerResults.length > 0 && (
              <ul
                style={{
                  listStyle: 'none',
                  border: '1px solid #ccc',
                  padding: 0,
                  margin: 0,
                  position: 'absolute',
                  background: '#fff',
                  width: '100%',
                  zIndex: 10,
                }}
              >
                {workerResults.map((worker) => (
                  <li key={worker.id}>
                    <button
                      type="button"
                      onClick={() => selectWorker(worker)}
                      style={{ width: '100%', textAlign: 'left', padding: '0.5rem' }}
                    >
                      {worker.firstName} {worker.lastName}
                      {worker.employeeCode ? ` — #${worker.employeeCode}` : ''}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {selectedWorker && !bulkMode && (
          <div
            style={{
              marginBottom: '1rem',
              padding: '0.75rem',
              background: '#f0f4f8',
              borderRadius: '6px',
              fontSize: '0.875rem',
              lineHeight: 1.5,
            }}
          >
            {weeklyHoursLoading && <p style={{ margin: 0 }}>Loading hours…</p>}
            {!weeklyHoursLoading && weeklyHours && (
              <>
                <p style={{ margin: '0 0 0.5rem', fontWeight: 600 }}>
                  Week of {formatWeekdayDate(weeklyHours.weekStart)} –{' '}
                  {formatWeekdayDate(weeklyHours.weekEnd)}
                </p>
                <p style={{ margin: 0 }}>Regular: {weeklyHours.regularHours} hrs</p>
                <p style={{ margin: 0 }}>Overtime: {weeklyHours.otHours} hrs</p>
                <p
                  style={{
                    margin: '0.25rem 0 0',
                    color: remainingOtColor(weeklyHours.remainingBeforeOT),
                    fontWeight: 500,
                  }}
                >
                  Remaining before OT: {weeklyHours.remainingBeforeOT} hrs
                </p>
              </>
            )}
          </div>
        )}

        <div style={{ marginBottom: '1rem' }}>
          <label htmlFor="pay-code">Pay code</label>
          <select
            id="pay-code"
            value={selectedPayCodeId}
            onChange={(e) => {
              setBulkConfirming(false);
              setSelectedPayCodeId(e.target.value);
            }}
            required
            disabled={!workerReady}
            style={{ display: 'block', width: '100%', padding: '0.5rem' }}
          >
            <option value="">Select pay code…</option>
            <optgroup label="Hours">
              {BASE_PAY_CODES.map((code) => (
                <option key={code.id} value={code.id}>
                  {code.label}
                </option>
              ))}
            </optgroup>
            <optgroup label="Reimbursements">
              <option value={GENERIC_REIMBURSE_CODE.id}>{GENERIC_REIMBURSE_CODE.label}</option>
            </optgroup>
          </select>
        </div>

        {!isReimbursementEntry && (
          <div style={{ marginBottom: '1rem' }}>
            <label htmlFor="hours">Hours</label>
            <input
              id="hours"
              type="number"
              step="0.5"
              min={isAdmin ? undefined : '0.5'}
              value={hours}
              onChange={(e) => {
                setBulkConfirming(false);
                setHours(e.target.value);
              }}
              required
              style={{
                display: 'block',
                width: '100%',
                padding: '0.5rem',
                color: isHoursCorrection ? '#b91c1c' : undefined,
              }}
            />
            {isHoursCorrection && (
              <p style={{ margin: '0.35rem 0 0', color: '#b91c1c', fontSize: '0.875rem' }}>
                Correction — this amount will be deducted from existing hours.
              </p>
            )}
          </div>
        )}

        {isReimbursementEntry && (
          <div style={{ marginBottom: '1rem' }}>
            <label htmlFor="reimbursement">Reimbursement Amount ($)</label>
            <input
              id="reimbursement"
              type="number"
              step="0.01"
              min={isAdmin ? undefined : '0.01'}
              value={reimbursement}
              onChange={(e) => {
                setBulkConfirming(false);
                setReimbursement(e.target.value);
              }}
              required
              style={{
                display: 'block',
                width: '100%',
                padding: '0.5rem',
                color: isReimbCorrection ? '#b91c1c' : undefined,
              }}
            />
            {showPaychexRecurringWarning && (
              <p
                style={{
                  margin: '0.5rem 0 0',
                  padding: '0.5rem 0.75rem',
                  background: '#fff7ed',
                  border: '1px solid #fdba74',
                  borderRadius: 4,
                  color: '#9a3412',
                  fontSize: '0.875rem',
                }}
              >
                This worker has a recurring reimbursement in Paychex:{' '}
                <strong>${paychexRecurringTotal.toFixed(2)}</strong> per pay period.
                This is configured in Paychex and will be paid automatically — enter an
                internal reimbursement here only if it is additional.
              </p>
            )}
            {isReimbCorrection && (
              <p style={{ margin: '0.35rem 0 0', color: '#b91c1c', fontSize: '0.875rem' }}>
                Correction — this amount will be deducted from existing reimbursements.
              </p>
            )}
          </div>
        )}

        {!isReimbursementEntry && showPaychexRecurringWarning && (
          <p
            style={{
              margin: '0 0 1rem',
              padding: '0.5rem 0.75rem',
              background: '#fff7ed',
              border: '1px solid #fdba74',
              borderRadius: 4,
              color: '#9a3412',
              fontSize: '0.875rem',
            }}
          >
            Paychex recurring reimbursement:{' '}
            <strong>${paychexRecurringTotal.toFixed(2)}</strong> per pay period
            (paid automatically in Paychex).
          </p>
        )}

        {bulkMode && bulkConfirming && (
          <div className="bulk-entry-summary">
            <p style={{ margin: '0 0 0.5rem', fontWeight: 600 }}>Confirm bulk entry</p>
            <p style={{ margin: 0 }}>
              This will create {selectedWorkers.length}{' '}
              {selectedWorkers.length === 1 ? 'entry' : 'entries'}: {quantityLabel} for{' '}
              {jobSiteLabel} on {formatDateShort(entryDate)} for: {workerNames.join(', ')}
            </p>
          </div>
        )}

        {bulkResult?.results?.length > 0 && (
          <div className="bulk-entry-result">
            {bulkResult.results.filter((row) => row.ok).length > 0 && (
              <div>
                <p style={{ margin: '0 0 0.35rem', fontWeight: 600, color: '#15803d' }}>
                  Created
                </p>
                <ul>
                  {bulkResult.results
                    .filter((row) => row.ok)
                    .map((row) => (
                      <li key={`ok-${row.workerId}`}>
                        {row.workerName || workerNameById[String(row.workerId)] || row.workerId}
                        {row.message ? ` — ${row.message}` : ''}
                      </li>
                    ))}
                </ul>
              </div>
            )}
            {bulkResult.results.filter((row) => !row.ok).length > 0 && (
              <div>
                <p style={{ margin: '0 0 0.35rem', fontWeight: 600, color: '#b91c1c' }}>
                  Failed
                </p>
                <ul>
                  {bulkResult.results
                    .filter((row) => !row.ok)
                    .map((row) => (
                      <li key={`fail-${row.workerId}`}>
                        {row.workerName || workerNameById[String(row.workerId)] || row.workerId}
                        {row.message ? ` — ${row.message}` : ''}
                      </li>
                    ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {bulkMode && bulkConfirming ? (
          <div className="inline-actions">
            <button type="submit" disabled={saving || readOnly}>
              {saving
                ? 'Creating…'
                : `Create ${selectedWorkers.length} ${selectedWorkers.length === 1 ? 'entry' : 'entries'}`}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={saving}
              onClick={() => setBulkConfirming(false)}
            >
              Back
            </button>
          </div>
        ) : (
          <button type="submit" disabled={saving || readOnly}>
            {saving
              ? 'Saving…'
              : readOnly
                ? 'Read-only'
                : bulkMode
                  ? 'Review bulk entry'
                  : 'Save Entry'}
          </button>
        )}
      </form>
    </div>
  );
}
