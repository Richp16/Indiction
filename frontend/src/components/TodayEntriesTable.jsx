import { useState, useEffect } from 'react';
import client from '../api/client';

function getToday() {
  return new Date().toISOString().split('T')[0];
}

function formatTime(timestamp) {
  if (!timestamp) return '—';
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function isReimbursement(componentName) {
  if (!componentName) return false;
  const lower = componentName.toLowerCase();
  return lower.includes('reimburse') || lower.includes('truck');
}

export default function TodayEntriesTable({ refreshTrigger }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState('');

  async function fetchEntries() {
    setLoading(true);
    setError(null);
    try {
      const response = await client.get('/api/entries', {
        params: { date: getToday() },
      });
      setEntries(response.data);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load entries');
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchEntries();
  }, [refreshTrigger]);

  function startEdit(entry) {
    setEditingId(entry.id);
    const reimb = isReimbursement(entry.component_name);
    setEditValue(
      reimb
        ? String(parseFloat(entry.reimbursement_amount) || 0)
        : String(parseFloat(entry.hours) || 0)
    );
  }

  function cancelEdit() {
    setEditingId(null);
    setEditValue('');
  }

  async function saveEdit(entry) {
    const reimb = isReimbursement(entry.component_name);
    const value = parseFloat(editValue);

    try {
      const payload = reimb
        ? { reimbursementAmount: value }
        : { hours: value };
      await client.put(`/api/entries/${entry.id}`, payload);
      setEditingId(null);
      setEditValue('');
      fetchEntries();
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to update entry');
    }
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this entry?')) return;
    try {
      await client.delete(`/api/entries/${id}`);
      fetchEntries();
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to delete entry');
    }
  }

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 'var(--space-8)' }}>
        <span className="spinner" aria-label="Loading entries" />
        <p className="form-hint" style={{ marginTop: 'var(--space-3)' }}>
          Loading today&apos;s entries…
        </p>
      </div>
    );
  }

  if (error) {
    return <div className="alert alert-error">{error}</div>;
  }

  if (entries.length === 0) {
    return (
      <p className="form-hint" style={{ textAlign: 'center', padding: 'var(--space-8)' }}>
        No entries logged today
      </p>
    );
  }

  return (
    <div className="table-wrapper">
      <table className="data-table">
        <thead>
          <tr>
            <th>Worker</th>
            <th>Site</th>
            <th>Pay Code</th>
            <th className="text-right">Hours / Amount</th>
            <th>Entered</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            const reimb = isReimbursement(entry.component_name);
            const isEditing = editingId === entry.id;

            return (
              <tr key={entry.id}>
                <td>
                  {entry.worker_first_name} {entry.worker_last_name}
                </td>
                <td>{entry.job_site_name}</td>
                <td>{entry.component_name}</td>
                <td className="text-right">
                  {isEditing ? (
                    <input
                      type="number"
                      className="form-input"
                      step={reimb ? '0.01' : '0.5'}
                      min="0"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      style={{ maxWidth: '100px' }}
                    />
                  ) : reimb ? (
                    `$${(parseFloat(entry.reimbursement_amount) || 0).toFixed(2)}`
                  ) : (
                    (parseFloat(entry.hours) || 0).toFixed(1)
                  )}
                </td>
                <td>{formatTime(entry.created_at)}</td>
                <td>
                  {isEditing ? (
                    <div className="inline-actions">
                      <button
                        type="button"
                        className="btn btn-primary action-btn"
                        onClick={() => saveEdit(entry)}
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary action-btn"
                        onClick={cancelEdit}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="inline-actions">
                      <button
                        type="button"
                        className="action-btn"
                        onClick={() => startEdit(entry)}
                        aria-label="Edit entry"
                      >
                        ✏️
                      </button>
                      <button
                        type="button"
                        className="action-btn"
                        onClick={() => handleDelete(entry.id)}
                        aria-label="Delete entry"
                      >
                        🗑️
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
