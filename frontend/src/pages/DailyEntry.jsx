import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiGet, apiPost } from '../api/client';

const BASE_PAY_CODES = [
  { id: 'REGULAR', label: 'Regular Hours', paychexComponentId: null },
  { id: 'OT', label: 'Overtime', paychexComponentId: null },
  { id: 'REIMBURSE', label: 'Reimbursement', paychexComponentId: '1080039968202498' },
];

function getToday() {
  return new Date().toISOString().split('T')[0];
}

export default function DailyEntry() {
  const { token } = useAuth();

  const [period, setPeriod] = useState(null);
  const [jobSites, setJobSites] = useState([]);
  const [selectedJobSiteId, setSelectedJobSiteId] = useState('');
  const [searchText, setSearchText] = useState('');
  const [workerResults, setWorkerResults] = useState([]);
  const [selectedWorker, setSelectedWorker] = useState(null);
  const [payCodes, setPayCodes] = useState(BASE_PAY_CODES);
  const [workerComponents, setWorkerComponents] = useState([]);
  const [selectedPayCodeId, setSelectedPayCodeId] = useState('');
  const [entryDate, setEntryDate] = useState(getToday());
  const [hours, setHours] = useState('');
  const [reimbursement, setReimbursement] = useState('');
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedMessage, setSavedMessage] = useState('');
  const debounceRef = useRef(null);

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
        setWorkerResults(workers);
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
      setPayCodes(BASE_PAY_CODES);
      setWorkerComponents([]);
      setSelectedPayCodeId('');
      return;
    }

    async function loadPayComponents() {
      try {
        const components = await apiGet(
          `/api/workers/${selectedWorker.id}/pay-components`,
          token
        );
        setWorkerComponents(components);
        const combined = [
          ...BASE_PAY_CODES,
          ...components.map((c) => ({
            id: c.paychexComponentId,
            label: c.name,
            paychexComponentId: c.paychexComponentId,
          })),
        ];
        setPayCodes(combined);
      } catch {
        setWorkerComponents([]);
        setPayCodes(BASE_PAY_CODES);
      }
    }

    loadPayComponents();
  }, [selectedWorker, token]);

  function selectWorker(worker) {
    setSelectedWorker(worker);
    setSearchText(`${worker.firstName} ${worker.lastName}`);
    setWorkerResults([]);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setSavedMessage('');

    const selectedJobSite = jobSites.find((s) => s.id === selectedJobSiteId);
    const selectedPayCode = payCodes.find((p) => p.id === selectedPayCodeId);

    if (!period || !selectedJobSite || !selectedWorker || !selectedPayCode) {
      setError('Please complete all required fields');
      return;
    }

    let paychexComponentId = selectedPayCode.paychexComponentId;
    if (!paychexComponentId && workerComponents.length > 0) {
      paychexComponentId = workerComponents[0].paychexComponentId;
    }
    if (!paychexComponentId) {
      setError('Selected pay code has no Paychex component ID');
      return;
    }

    setSaving(true);
    try {
      await apiPost(
        '/api/entries',
        {
          workerId: selectedWorker.id,
          jobSiteId: selectedJobSite.id,
          payPeriodId: period.id,
          paychexComponentId,
          entryDate,
          hours: Number(hours) || 0,
          reimbursementAmount: Number(reimbursement) || 0,
        },
        token
      );
      setHours('');
      setReimbursement('');
      setSavedMessage('Saved');
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
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

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
            {payCodes.map((code) => (
              <option key={code.id} value={code.id}>
                {code.label}
              </option>
            ))}
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

        <div style={{ marginBottom: '1rem' }}>
          <label htmlFor="hours">Hours</label>
          <input
            id="hours"
            type="number"
            step="0.5"
            min="0"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            style={{ display: 'block', width: '100%', padding: '0.5rem' }}
          />
        </div>

        <div style={{ marginBottom: '1rem' }}>
          <label htmlFor="reimbursement">Reimbursement (optional)</label>
          <input
            id="reimbursement"
            type="number"
            step="0.01"
            min="0"
            value={reimbursement}
            onChange={(e) => setReimbursement(e.target.value)}
            style={{ display: 'block', width: '100%', padding: '0.5rem' }}
          />
        </div>

        <button type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save Entry'}
        </button>
      </form>
    </div>
  );
}
