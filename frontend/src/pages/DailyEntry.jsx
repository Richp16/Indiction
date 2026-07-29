import { useState, useEffect, useRef, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiGet, apiPost } from '../api/client';

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

export default function DailyEntry() {
  const { token, isAdmin } = useAuth();

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
    if (!selectedWorker) {
      setSelectedPayCodeId('');
      setPaychexRecurringReimb(null);
    }
  }, [selectedWorker]);

  useEffect(() => {
    if (!isAdmin || !selectedWorker || !token) {
      setPaychexRecurringReimb(null);
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
  }, [isAdmin, selectedWorker, token]);

  useEffect(() => {
    if (!selectedWorker || !period) {
      setWeeklyHours(null);
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
  }, [selectedWorker, entryDate, period, token, weeklyHoursRefresh]);

  function selectWorker(worker) {
    setSelectedWorker(worker);
    setSearchText(`${worker.firstName} ${worker.lastName}`);
    setWorkerResults([]);
    setSelectedPayCodeId('');
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setSavedMessage('');

    if (!selectedWorker || !selectedPayCode) {
      setError('Please complete all required fields');
      return;
    }
    if (!entryDate) {
      setError('Work Date is required');
      return;
    }
    if (!isAdmin && !period) {
      setError('Please complete all required fields');
      return;
    }

    const jobSiteId = selectedJobSiteId || null;

    if (selectedPayCode.type === 'HOURS') {
      const hoursValue = Number(hours);
      if (!hours || hoursValue === 0 || Number.isNaN(hoursValue)) {
        setError('Hours must be a non-zero value');
        return;
      }
      if (!isAdmin && hoursValue < 0) {
        setError('Hours must be greater than zero for wage entries');
        return;
      }
    } else {
      const reimbValue = Number(reimbursement);
      if (!reimbursement || reimbValue === 0 || Number.isNaN(reimbValue)) {
        setError('Reimbursement amount must be a non-zero value');
        return;
      }
      if (!isAdmin && reimbValue < 0) {
        setError('Reimbursement amount must be greater than zero');
        return;
      }
    }

    const payload = {
      workerId: selectedWorker.id,
      jobSiteId,
      entry_date: entryDate,
      hours: isReimbursementEntry ? 0 : Number(hours) || 0,
      reimbursementAmount: isReimbursementEntry ? Number(reimbursement) : 0,
      payCode: selectedPayCodeId,
    };
    // Admins omit payPeriodId so the backend resolves from the work date.
    if (!isAdmin && period?.id) {
      payload.payPeriodId = period.id;
    }

    setSaving(true);
    try {
      const result = await apiPost('/api/entries', payload, token);
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
    } catch (err) {
      setError(err.message || 'Failed to save entry');
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
    isAdmin && selectedWorker && paychexRecurringTotal > 0;

  return (
    <div>
      <h1>Daily Entry</h1>

      {period && (
        <p>
          Pay period: {period.start_date} – {period.end_date}
          {isAdmin ? ' (resolved from work date)' : ''}
        </p>
      )}

      {!isAdmin && (
        <p style={{ color: '#64748b', fontSize: '0.9rem' }}>
          Work dates are limited to the current week ({currentWeekBounds.sunday} –{' '}
          {currentWeekBounds.saturday}).
        </p>
      )}

      {isAdmin && (
        <p style={{ color: '#64748b', fontSize: '0.9rem' }}>
          Admins can enter time for any date that falls in a defined pay period,
          including past periods.
        </p>
      )}

      {selectedWorker?.standardRate != null && (
        <p>Worker hourly rate: ${Number(selectedWorker.standardRate).toFixed(2)}/hr</p>
      )}

      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      {savedMessage && <p style={{ color: 'green' }}>{savedMessage}</p>}

      <form onSubmit={handleSubmit} style={{ maxWidth: 480 }}>
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
            onChange={(e) => setSelectedJobSiteId(e.target.value)}
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

        {selectedWorker && (
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
            onChange={(e) => setSelectedPayCodeId(e.target.value)}
            required
            disabled={!selectedWorker}
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
              onChange={(e) => setHours(e.target.value)}
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
              onChange={(e) => setReimbursement(e.target.value)}
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

        <button type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save Entry'}
        </button>
      </form>
    </div>
  );
}
