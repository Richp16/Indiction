import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useAppConfig } from '../context/AppConfigContext';
import { apiPost } from '../api/client';

export default function SetupModePage() {
  const { token } = useAuth();
  const { refreshConfig } = useAppConfig();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function chooseMode(paychexEnabled) {
    setLoading(true);
    setError('');
    try {
      await apiPost('/api/account/setup', { paychexEnabled }, token);
      await refreshConfig();
      navigate(paychexEnabled ? '/daily-entry' : '/admin/employees', { replace: true });
    } catch (err) {
      setError(err.message || 'Failed to save setup choice');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 640, margin: '3rem auto', padding: '0 1rem' }}>
      <h1>Welcome to Indiction</h1>
      <p>Choose how this office will run payroll before you continue.</p>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      <div style={{ display: 'grid', gap: '1rem', marginTop: '1.5rem' }}>
        <button
          type="button"
          disabled={loading}
          onClick={() => chooseMode(true)}
          style={{ textAlign: 'left', padding: '1rem' }}
        >
          <strong>Paychex Flex</strong>
          <div>Sync workers, pay periods, and checks from Paychex. Export SPI payroll files.</div>
        </button>
        <button
          type="button"
          disabled={loading}
          onClick={() => chooseMode(false)}
          style={{ textAlign: 'left', padding: '1rem' }}
        >
          <strong>Non-Paychex (local payroll)</strong>
          <div>Manage workers and pay periods in Indiction. Enter hours locally and export WH-347 PDFs.</div>
        </button>
      </div>
    </div>
  );
}
