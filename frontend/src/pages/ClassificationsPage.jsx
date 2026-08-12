import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { ADMIN_CONFIG_SCOPE, useEditScope } from '../context/EditLockContext';
import { apiDelete, apiGet, apiPatch, apiPost } from '../api/client';

export default function ClassificationsPage() {
  const { token } = useAuth();
  useEditScope(ADMIN_CONFIG_SCOPE);
  const [rows, setRows] = useState([]);
  const [workers, setWorkers] = useState([]);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [savedWorkerId, setSavedWorkerId] = useState('');

  async function loadClassifications() {
    const data = await apiGet('/api/labor-classifications', token);
    setRows(data);
  }

  async function loadWorkers() {
    const data = await apiGet('/api/workers/assignments', token);
    setWorkers(data);
  }

  async function load() {
    await Promise.all([loadClassifications(), loadWorkers()]);
  }

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, [token]);

  async function updateWorkerClassification(workerId, classificationId) {
    setError('');
    const previous = workers.find((w) => w.id === workerId);
    const selected = rows.find((r) => String(r.id) === String(classificationId));
    setWorkers((all) =>
      all.map((worker) =>
        worker.id === workerId
          ? {
              ...worker,
              laborClassificationId: classificationId ? Number(classificationId) : null,
              laborClassificationName: selected?.name || null,
            }
          : worker
      )
    );

    try {
      await apiPatch(
        `/api/workers/${workerId}/classification`,
        { classificationId: classificationId || null },
        token
      );
      setSavedWorkerId(workerId);
      window.setTimeout(() => setSavedWorkerId(''), 2000);
    } catch (err) {
      if (previous) {
        setWorkers((all) =>
          all.map((worker) => (worker.id === workerId ? previous : worker))
        );
      }
      setError(err.message);
    }
  }

  return (
    <div>
      <h1>Labor Classifications</h1>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Classification name" />
        <button
          type="button"
          onClick={() =>
            apiPost('/api/labor-classifications', { name }, token)
              .then(() => {
                setName('');
                return loadClassifications();
              })
              .catch((err) => setError(err.message))
          }
        >
          Add
        </button>
      </div>
      <table>
        <thead>
          <tr>
            <th style={{ textAlign: 'left' }}>Name</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{row.name}</td>
              <td>
                <button
                  type="button"
                  onClick={() => {
                    if (!window.confirm('Delete this classification?')) return;
                    apiDelete(`/api/labor-classifications/${row.id}`, token)
                      .then(load)
                      .catch((err) => setError(err.message));
                  }}
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 style={{ marginTop: '2rem' }}>Worker Classifications</h2>
      <p style={{ color: '#555', marginBottom: '1rem' }}>
        Assign each worker&apos;s primary labor classification. Certified Payroll reads this value
        automatically.
      </p>
      <table>
        <thead>
          <tr>
            <th style={{ textAlign: 'left' }}>Worker</th>
            <th style={{ textAlign: 'left' }}>Classification</th>
          </tr>
        </thead>
        <tbody>
          {workers.length === 0 && (
            <tr>
              <td colSpan={2} style={{ color: '#666' }}>
                No active workers found.
              </td>
            </tr>
          )}
          {workers.map((worker) => (
            <tr key={worker.id}>
              <td>
                {worker.lastName}, {worker.firstName}
                {worker.employeeCode ? ` (#${worker.employeeCode})` : ''}
                {savedWorkerId === worker.id && (
                  <span style={{ marginLeft: 8, color: '#15803d', fontSize: '0.85rem' }}>Saved</span>
                )}
              </td>
              <td>
                <select
                  value={worker.laborClassificationId ?? ''}
                  onChange={(e) => updateWorkerClassification(worker.id, e.target.value)}
                  style={{ minWidth: 200, padding: '0.35rem 0.5rem' }}
                >
                  <option value="">— None —</option>
                  {rows.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.name}
                    </option>
                  ))}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
