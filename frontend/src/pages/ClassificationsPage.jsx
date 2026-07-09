import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiDelete, apiGet, apiPost } from '../api/client';

export default function ClassificationsPage() {
  const { token } = useAuth();
  const [rows, setRows] = useState([]);
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  async function load() {
    const data = await apiGet('/api/labor-classifications', token);
    setRows(data);
  }

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, [token]);

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
                return load();
              })
              .catch((err) => setError(err.message))
          }
        >
          Add
        </button>
      </div>
      <table>
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
    </div>
  );
}
