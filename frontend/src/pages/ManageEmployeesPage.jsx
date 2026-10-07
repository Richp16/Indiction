import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useEditLock } from '../context/EditLockContext';
import { apiDelete, apiGet, apiPatch, apiPost } from '../api/client';

const emptyWorker = {
  employeeCode: '',
  firstName: '',
  lastName: '',
  standardRate: '',
  laborClassificationId: '',
  workerType: 'J',
  isActive: true,
  address: '',
  identifyingLast4: '',
};

const emptyPeriod = {
  startDate: '',
  endDate: '',
  submitByDate: '',
  payDate: '',
  status: 'OPEN',
};

export default function ManageEmployeesPage() {
  const { token } = useAuth();
  const { isLockHolder, acquireLock } = useEditLock();
  const [tab, setTab] = useState('workers');
  const [workers, setWorkers] = useState([]);
  const [periods, setPeriods] = useState([]);
  const [classifications, setClassifications] = useState([]);
  const [workerForm, setWorkerForm] = useState(emptyWorker);
  const [periodForm, setPeriodForm] = useState(emptyPeriod);
  const [editingWorkerId, setEditingWorkerId] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function loadData() {
    const [workerRows, periodRows, classRows] = await Promise.all([
      apiGet('/api/workers/admin', token),
      apiGet('/api/pay-periods', token),
      apiGet('/api/labor-classifications', token),
    ]);
    setWorkers(workerRows);
    setPeriods(periodRows);
    setClassifications(classRows);
  }

  useEffect(() => {
    loadData().catch((err) => setError(err.message));
  }, [token]);

  async function ensureLock() {
    if (!isLockHolder) {
      await acquireLock();
    }
  }

  async function saveWorker() {
    setError('');
    setMessage('');
    try {
      await ensureLock();
      const payload = {
        ...workerForm,
        standardRate: workerForm.standardRate === '' ? null : workerForm.standardRate,
      };
      if (editingWorkerId) {
        await apiPatch(`/api/workers/${editingWorkerId}`, payload, token);
        setMessage('Worker updated');
      } else {
        await apiPost('/api/workers', payload, token);
        setMessage('Worker created');
      }
      setWorkerForm(emptyWorker);
      setEditingWorkerId(null);
      await loadData();
    } catch (err) {
      setError(err.message);
    }
  }

  async function savePeriod() {
    setError('');
    setMessage('');
    try {
      await ensureLock();
      await apiPost('/api/pay-periods', periodForm, token);
      setMessage('Pay period created');
      setPeriodForm(emptyPeriod);
      await loadData();
    } catch (err) {
      setError(err.message);
    }
  }

  async function setPeriodStatus(id, status) {
    try {
      await ensureLock();
      if (status === 'OPEN') {
        const ok = window.confirm('Reopen this period? Confirm you intend to edit finalized payroll.');
        if (!ok) return;
      }
      await apiPatch(`/api/pay-periods/${id}`, { status }, token);
      setMessage(`Period status → ${status}`);
      await loadData();
    } catch (err) {
      setError(err.message);
    }
  }

  async function deletePeriod(id) {
    if (!window.confirm('Delete this pay period?')) return;
    try {
      await ensureLock();
      await apiDelete(`/api/pay-periods/${id}`, token);
      setMessage('Pay period deleted');
      await loadData();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div>
      <h1>Manage Employees</h1>
      <p>
        Workers and pay periods for Non-Paychex mode.{' '}
        <Link to="/local-payroll">Open Local Payroll</Link>
      </p>
      {message && <p style={{ color: 'green' }}>{message}</p>}
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      {!isLockHolder && (
        <p style={{ color: '#b45309' }}>
          Acquire the edit lock to create or update records.
        </p>
      )}

      <div style={{ display: 'flex', gap: '0.5rem', margin: '1rem 0' }}>
        <button type="button" onClick={() => setTab('workers')}>
          Workers
        </button>
        <button type="button" onClick={() => setTab('periods')}>
          Pay Periods
        </button>
      </div>

      {tab === 'workers' && (
        <div style={{ display: 'grid', gap: '1rem' }}>
          <div style={{ display: 'grid', gap: 8, maxWidth: 480 }}>
            <input
              placeholder="Employee code (unique)"
              value={workerForm.employeeCode}
              onChange={(e) => setWorkerForm((s) => ({ ...s, employeeCode: e.target.value }))}
            />
            <input
              placeholder="First name"
              value={workerForm.firstName}
              onChange={(e) => setWorkerForm((s) => ({ ...s, firstName: e.target.value }))}
            />
            <input
              placeholder="Last name"
              value={workerForm.lastName}
              onChange={(e) => setWorkerForm((s) => ({ ...s, lastName: e.target.value }))}
            />
            <input
              placeholder="Standard rate"
              value={workerForm.standardRate}
              onChange={(e) => setWorkerForm((s) => ({ ...s, standardRate: e.target.value }))}
            />
            <input
              placeholder="Address (optional, WH-347)"
              value={workerForm.address}
              onChange={(e) => setWorkerForm((s) => ({ ...s, address: e.target.value }))}
            />
            <input
              placeholder="Identifying last 4 (optional)"
              maxLength={4}
              value={workerForm.identifyingLast4}
              onChange={(e) => setWorkerForm((s) => ({ ...s, identifyingLast4: e.target.value }))}
            />
            <select
              value={workerForm.laborClassificationId}
              onChange={(e) =>
                setWorkerForm((s) => ({ ...s, laborClassificationId: e.target.value }))
              }
            >
              <option value="">Classification (optional)</option>
              {classifications.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <select
              value={workerForm.workerType}
              onChange={(e) => setWorkerForm((s) => ({ ...s, workerType: e.target.value }))}
            >
              <option value="J">Journeyman (J)</option>
              <option value="RA">Apprentice (RA)</option>
            </select>
            <label>
              <input
                type="checkbox"
                checked={workerForm.isActive}
                onChange={(e) => setWorkerForm((s) => ({ ...s, isActive: e.target.checked }))}
              />{' '}
              Active (inactive workers stay in history, leave new-entry selectors)
            </label>
            <button type="button" onClick={saveWorker} disabled={!isLockHolder}>
              {editingWorkerId ? 'Update worker' : 'Add worker'}
            </button>
          </div>

          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Rate</th>
                <th>Active</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {workers.map((w) => (
                <tr key={w.id}>
                  <td>{w.employeeCode || '—'}</td>
                  <td>
                    {w.lastName}, {w.firstName}
                  </td>
                  <td>{w.standardRate ?? '—'}</td>
                  <td>{w.isActive ? 'Yes' : 'No'}</td>
                  <td>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingWorkerId(w.id);
                        setWorkerForm({
                          employeeCode: w.employeeCode || '',
                          firstName: w.firstName,
                          lastName: w.lastName,
                          standardRate: w.standardRate ?? '',
                          laborClassificationId: w.laborClassificationId || '',
                          workerType: w.workerType || 'J',
                          isActive: w.isActive,
                          address: w.address || '',
                          identifyingLast4: w.identifyingLast4 || '',
                        });
                      }}
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'periods' && (
        <div style={{ display: 'grid', gap: '1rem' }}>
          <div style={{ display: 'grid', gap: 8, maxWidth: 480 }}>
            <label>
              Start
              <input
                type="date"
                value={periodForm.startDate}
                onChange={(e) => setPeriodForm((s) => ({ ...s, startDate: e.target.value }))}
              />
            </label>
            <label>
              End
              <input
                type="date"
                value={periodForm.endDate}
                onChange={(e) => setPeriodForm((s) => ({ ...s, endDate: e.target.value }))}
              />
            </label>
            <label>
              Submit by
              <input
                type="date"
                value={periodForm.submitByDate}
                onChange={(e) => setPeriodForm((s) => ({ ...s, submitByDate: e.target.value }))}
              />
            </label>
            <label>
              Pay date
              <input
                type="date"
                value={periodForm.payDate}
                onChange={(e) => setPeriodForm((s) => ({ ...s, payDate: e.target.value }))}
              />
            </label>
            <button type="button" onClick={savePeriod} disabled={!isLockHolder}>
              Add pay period
            </button>
          </div>

          <table>
            <thead>
              <tr>
                <th>Period</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {periods.map((p) => (
                <tr key={p.id}>
                  <td>{p.label}</td>
                  <td>{p.status}</td>
                  <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {p.status !== 'CLOSED' && (
                      <button
                        type="button"
                        disabled={!isLockHolder}
                        onClick={() => setPeriodStatus(p.id, 'CLOSED')}
                      >
                        Close
                      </button>
                    )}
                    {p.status !== 'OPEN' && (
                      <button
                        type="button"
                        disabled={!isLockHolder}
                        onClick={() => setPeriodStatus(p.id, 'OPEN')}
                      >
                        Reopen
                      </button>
                    )}
                    <button type="button" onClick={() => deletePeriod(p.id)} disabled={!isLockHolder}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
