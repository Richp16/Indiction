import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiGet, apiPost } from '../api/client';

const BASE_PAY_CODES = [
  { id: 'REGULAR', label: 'Regular Hours', type: 'HOURS' },
  { id: 'OT', label: 'Overtime', type: 'HOURS' },
  { id: 'PTO', label: 'Paid Time Off', type: 'HOURS' },
];

const GENERIC_REIMBURSE_CODE = {
  id: 'REIMBURSE',
  label: 'Reimbursement',
  type: 'REIMBURSEMENT',
};

function getToday() {
  return new Date().toISOString().split('T')[0];
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
  const { token } = useAuth();

  const [period, setPeriod] = useState(null);
  const [jobSites, setJobSites] = useState([]);
  const [selectedJobSiteId, setSelectedJobSiteId] = useState('');
  const [searchText, setSearchText] = useState('');
  const [workerResults, setWorkerResults] = useState([]);
  const [selectedWorker, setSelectedWorker] = useState(null);
  const [reimbursementPayCodes, setReimbursementPayCodes] = useState([]);
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
  const debounceRef = useRef(null);

  const reimbursementOptions = [GENERIC_REIMBURSE_CODE, ...reimbursementPayCodes];
  const payCodes = [...BASE_PAY_CODES, ...reimbursementOptions];
  const selectedPayCode = payCodes.find((code) => code.id === selectedPayCodeId);
  const isReimbursementEntry = selectedPayCode?.type === 'REIMBURSEMENT';

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
        setJobSites(sitesData);
      } catch (err) {
        setError(err.message || 'Failed to load page data');
      } finally {
        setLoading(false);
      }
    }
    loadInitial();
  }, [token]);

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
      setReimbursementPayCodes([]);
      setSelectedPayCodeId('');
      return;
    }

    async function loadReimbursementComponents() {
      try {
        const components = await apiGet(
          `/api/workers/${selectedWorker.id}/pay-components`,
          token
        );
        setReimbursementPayCodes(
          components.map((c) => ({
            id: c.paychexComponentId,
            label: c.name,
            type: 'REIMBURSEMENT',
            paychexComponentId: c.paychexComponentId,
          }))
        );
      } catch {
        setReimbursementPayCodes([]);
      }
    }

    loadReimbursementComponents();
  }, [selectedWorker, token]);

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

    const selectedJobSite = jobSites.find((s) => s.id === selectedJobSiteId);

    if (!period || !selectedJobSite || !selectedWorker || !selectedPayCode) {
      setError('Please complete all required fields');
      return;
    }

    if (selectedPayCode.type === 'HOURS') {
      if (!hours || Number(hours) <= 0) {
        setError('Hours must be greater than zero for wage entries');
        return;
      }
    } else if (!reimbursement || Number(reimbursement) <= 0) {
      setError('Reimbursement amount must be greater than zero');
      return;
    }

    const payload = {
      workerId: selectedWorker.id,
      jobSiteId: selectedJobSite.id,
      payPeriodId: period.id,
      entryDate,
      hours: isReimbursementEntry ? 0 : Number(hours) || 0,
      reimbursementAmount: isReimbursementEntry ? Number(reimbursement) : 0,
      payCode: selectedPayCodeId,
    };

    if (isReimbursementEntry && selectedPayCode.paychexComponentId) {
      payload.paychexComponentId = selectedPayCode.paychexComponentId;
    }

    setSaving(true);
    try {
      const result = await apiPost('/api/entries', payload, token);
      setHours('');
      setReimbursement('');
      if (result?.split) {
        setSavedMessage(result.message);
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

  return (
    <div>
      <h1>Daily Entry</h1>

      {period && (
        <p>
          Pay period: {period.start_date} – {period.end_date}
        </p>
      )}

      {selectedWorker?.standardRate != null && (
        <p>Worker hourly rate: ${Number(selectedWorker.standardRate).toFixed(2)}/hr</p>
      )}

      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      {savedMessage && <p style={{ color: 'green' }}>{savedMessage}</p>}

      <form onSubmit={handleSubmit} style={{ maxWidth: 480 }}>
        <div style={{ marginBottom: '1rem' }}>
          <label htmlFor="job-site">Worksite</label>
          <select
            id="job-site"
            value={selectedJobSiteId}
            onChange={(e) => setSelectedJobSiteId(e.target.value)}
            required
            style={{ display: 'block', width: '100%', padding: '0.5rem' }}
          >
            <option value="">Select a job site…</option>
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
                    {worker.standardRate != null
                      ? ` ($${Number(worker.standardRate).toFixed(2)}/hr)`
                      : ''}
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
              {reimbursementPayCodes.map((code) => (
                <option key={code.id} value={code.id}>
                  {code.label}
                </option>
              ))}
            </optgroup>
          </select>
        </div>

        <div style={{ marginBottom: '1rem' }}>
          <label htmlFor="entry-date">Date</label>
          <input
            id="entry-date"
            type="date"
            value={entryDate}
            min={period?.start_date}
            max={period?.end_date}
            onChange={(e) => setEntryDate(e.target.value)}
            required
            style={{ display: 'block', width: '100%', padding: '0.5rem' }}
          />
        </div>

        {!isReimbursementEntry && (
          <div style={{ marginBottom: '1rem' }}>
            <label htmlFor="hours">Hours</label>
            <input
              id="hours"
              type="number"
              step="0.5"
              min="0.5"
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              required
              style={{ display: 'block', width: '100%', padding: '0.5rem' }}
            />
          </div>
        )}

        {isReimbursementEntry && (
          <div style={{ marginBottom: '1rem' }}>
            <label htmlFor="reimbursement">Reimbursement Amount ($)</label>
            <input
              id="reimbursement"
              type="number"
              step="0.01"
              min="0.01"
              value={reimbursement}
              onChange={(e) => setReimbursement(e.target.value)}
              required
              style={{ display: 'block', width: '100%', padding: '0.5rem' }}
            />
          </div>
        )}

        <button type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save Entry'}
        </button>
      </form>
    </div>
  );
}
