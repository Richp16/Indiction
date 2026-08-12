import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiGet, apiPost, apiDelete, apiPatch } from '../api/client';

const ROLE_OPTIONS = [
  { value: 'superintendent', label: 'Superintendent' },
  { value: 'payroll_admin', label: 'Payroll Admin' },
];

function formatRole(role) {
  const option = ROLE_OPTIONS.find((r) => r.value === role);
  if (option) return option.label;
  if (role === 'system_admin') return 'System Admin';
  return role;
}

export default function ManageUsers() {
  const { token, user } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  const [formSuccess, setFormSuccess] = useState('');
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('superintendent');
  const [resettingId, setResettingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  async function loadUsers() {
    setLoading(true);
    setError('');
    try {
      const data = await apiGet('/api/users', token);
      setUsers(data);
    } catch (err) {
      setError(err.message || 'Failed to load users');
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadUsers();
  }, [token]);

  async function handleAddUser(e) {
    e.preventDefault();
    setSaving(true);
    setFormError('');
    setFormSuccess('');
    try {
      await apiPost(
        '/api/users',
        { name, email, password, role },
        token
      );
      setFormSuccess('User created');
      setName('');
      setEmail('');
      setPassword('');
      setRole('superintendent');
      await loadUsers();
    } catch (err) {
      setFormError(err.message || 'Failed to create user');
    } finally {
      setSaving(false);
    }
  }

  async function handleResetPassword(userId) {
    const newPassword = window.prompt('Enter new password:');
    if (!newPassword) return;

    setResettingId(userId);
    setError('');
    try {
      await apiPatch(`/api/users/${userId}/password`, { newPassword }, token);
      await loadUsers();
    } catch (err) {
      setError(err.message || 'Failed to reset password');
    } finally {
      setResettingId(null);
    }
  }

  async function handleDelete(userId) {
    if (!window.confirm('Delete this user?')) return;

    setDeletingId(userId);
    setError('');
    try {
      await apiDelete(`/api/users/${userId}`, token);
      await loadUsers();
    } catch (err) {
      setError(err.message || 'Failed to delete user');
    } finally {
      setDeletingId(null);
    }
  }

  if (loading && users.length === 0) {
    return <p>Loading…</p>;
  }

  return (
    <div>
      <h1>Manage Users</h1>

      <section style={{ marginBottom: '2rem' }}>
        <h2>Add User</h2>
        <form onSubmit={handleAddUser}>
          <div style={{ marginBottom: '0.75rem' }}>
            <label>
              Name{' '}
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </label>
          </div>
          <div style={{ marginBottom: '0.75rem' }}>
            <label>
              Email{' '}
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>
          </div>
          <div style={{ marginBottom: '0.75rem' }}>
            <label>
              Password{' '}
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </label>
          </div>
          <div style={{ marginBottom: '0.75rem' }}>
            <label>
              Role{' '}
              <select value={role} onChange={(e) => setRole(e.target.value)}>
                {ROLE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {formError && <p style={{ color: 'crimson' }}>{formError}</p>}
          {formSuccess && <p style={{ color: '#15803d' }}>{formSuccess}</p>}
          <button type="submit" disabled={saving}>
            {saving ? 'Adding…' : 'Add User'}
          </button>
        </form>
      </section>

      {error && <p style={{ color: 'crimson' }}>{error}</p>}

      <section>
        <h2>Users</h2>
        {users.length === 0 ? (
          <p>No users found.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>Name</th>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>Email</th>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>Role</th>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const isSelf = u.id === user?.id;
                return (
                  <tr key={u.id}>
                    <td style={{ borderBottom: '1px solid #eee' }}>{u.name || '—'}</td>
                    <td style={{ borderBottom: '1px solid #eee' }}>{u.email}</td>
                    <td style={{ borderBottom: '1px solid #eee' }}>{formatRole(u.role)}</td>
                    <td style={{ borderBottom: '1px solid #eee' }}>
                      {!isSelf && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleResetPassword(u.id)}
                            disabled={resettingId === u.id}
                            style={{ marginRight: '0.5rem' }}
                          >
                            {resettingId === u.id ? 'Resetting…' : 'Reset Password'}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(u.id)}
                            disabled={deletingId === u.id}
                          >
                            {deletingId === u.id ? 'Deleting…' : 'Delete'}
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

