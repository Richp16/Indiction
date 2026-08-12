import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiGet, apiPost } from '../api/client';
import PayrollExport from '../components/PayrollExport';

export default function Submit() {
  const { token } = useAuth();
  const [period, setPeriod] = useState(null);
  const [issues, setIssues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError('');
      try {
        const periodData = await apiGet('/api/pay-periods/current', token);
        setPeriod(periodData);
      } catch (err) {
        setError(err.message || 'Failed to load pay period');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [token]);

  async function handleValidate() {
    if (!period) return;
    setValidating(true);
    setError('');
    try {
      const result = await apiPost('/api/submit/validate', { payPeriodId: period.id }, token);
      setIssues(Array.isArray(result) ? result : []);
    } catch (err) {
      setError(err.message || 'Validation failed');
    } finally {
      setValidating(false);
    }
  }

  if (loading) {
    return <p>Loading…</p>;
  }

  return (
    <div>
      <h1>Submit Payroll</h1>

      {period && (
        <p>
          Pay period: {period.start_date} – {period.end_date}
        </p>
      )}

      {error && <p style={{ color: 'crimson' }}>{error}</p>}

      <div style={{ marginBottom: '1rem' }}>
        <button type="button" onClick={handleValidate} disabled={!period || validating}>
          {validating ? 'Validating…' : 'Validate'}
        </button>
      </div>

      {issues.length > 0 && (
        <ul>
          {issues.map((issue, index) => (
            <li key={index} style={{ color: issue.type === 'error' ? 'crimson' : '#964219' }}>
              [{issue.type}] {issue.message}
            </li>
          ))}
        </ul>
      )}

      {period && (
        <PayrollExport payPeriodId={period.id} token={token} showInstructions />
      )}
    </div>
  );
}

