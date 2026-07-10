import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiDelete, apiGet, apiPatch, apiPost } from '../api/client';

const emptyForm = {
  name: '',
  job_code: '',
  address: '',
  contract_number: '',
  wage_determination_no: '',
};

export default function JobSitesPage() {
  const { token } = useAuth();
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState('');

  async function load() {
    const data = await apiGet('/api/job-sites', token);
    setRows(data);
  }

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, [token]);

  async function saveNew() {
    setError('');
    await apiPost('/api/job-sites', form, token);
    setForm(emptyForm);
    await load();
  }

  async function saveEdit() {
    setError('');
    await apiPatch(`/api/job-sites/${editing.id}`, editing, token);
    setEditing(null);
    await load();
  }

  async function removeSite(id) {
    if (!window.confirm('Deleting this job site will not remove historical time entries. Are you sure?')) return;
    await apiDelete(`/api/job-sites/${id}`, token);
    await load();
  }

  return (
    <div>
      <h1>Job Sites</h1>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}

      <h2>Add Job Site</h2>
      <div style={{ display: 'grid', gap: 8, maxWidth: 500 }}>
        <input placeholder="Site Name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        <input placeholder="Job Code" value={form.job_code} onChange={(e) => setForm((f) => ({ ...f, job_code: e.target.value }))} />
        <input placeholder="Address" value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
        <input placeholder="Contract Number" value={form.contract_number} onChange={(e) => setForm((f) => ({ ...f, contract_number: e.target.value }))} />
        <input placeholder="Wage Determination No." value={form.wage_determination_no} onChange={(e) => setForm((f) => ({ ...f, wage_determination_no: e.target.value }))} />
        <button type="button" onClick={() => saveNew().catch((err) => setError(err.message))}>Add</button>
      </div>

      <h2 style={{ marginTop: 24 }}>All Job Sites</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th>Name</th><th>Job Code</th><th>Address</th><th>Contract No.</th><th>Wage Det. No.</th><th>Active</th><th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isEditing = editing?.id === row.id;
            const item = isEditing ? editing : row;
            return (
              <tr key={row.id}>
                <td><input disabled={!isEditing} value={item.name || ''} onChange={(e) => setEditing((s) => ({ ...s, name: e.target.value }))} /></td>
                <td><input disabled={!isEditing} value={item.job_code || ''} onChange={(e) => setEditing((s) => ({ ...s, job_code: e.target.value }))} /></td>
                <td><input disabled={!isEditing} value={item.address || ''} onChange={(e) => setEditing((s) => ({ ...s, address: e.target.value }))} /></td>
                <td><input disabled={!isEditing} value={item.contract_number || ''} onChange={(e) => setEditing((s) => ({ ...s, contract_number: e.target.value }))} /></td>
                <td><input disabled={!isEditing} value={item.wage_determination_no || ''} onChange={(e) => setEditing((s) => ({ ...s, wage_determination_no: e.target.value }))} /></td>
                <td><input type="checkbox" disabled={!isEditing} checked={!!item.is_active} onChange={(e) => setEditing((s) => ({ ...s, is_active: e.target.checked }))} /></td>
                <td>
                  {!isEditing ? (
                    <button type="button" onClick={() => setEditing({ ...row })}>Edit</button>
                  ) : (
                    <>
                      <button type="button" onClick={() => saveEdit().catch((err) => setError(err.message))}>Save</button>
                      <button type="button" onClick={() => setEditing(null)}>Cancel</button>
                    </>
                  )}
                  <button type="button" onClick={() => removeSite(row.id).catch((err) => setError(err.message))}>Delete</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
