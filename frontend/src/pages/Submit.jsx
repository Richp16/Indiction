import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiGet, apiPost } from '../api/client';

export default function Submit() {
  const { token } = useAuth();
  const [period, setPeriod] = useState(null);
  const [issues, setIssues] = useState([]);
  const [submitResult, setSubmitResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [validating, setValidating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

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

  const hasErrors = issues.some((issue) => issue.type === 'error');

  async function handleValidate() {
    if (!period) return;
    setValidating(true);
    setError('');
    setSuccessMessage('');
    try {
      const result = await apiPost('/api/submit/validate', { payPeriodId: period.id }, token);
      setIssues(Array.isArray(result) ? result : []);
    } catch (err) {
      setError(err.message || 'Validation failed');
    } finally {
      setValidating(false);
    }
  }

  async function handleSubmit() {
    if (!period || hasErrors) return;
    setSubmitting(true);
    setError('');
    setSuccessMessage('');
    try {
      const result = await apiPost('/api/submit/confirm', { payPeriodId: period.id }, token);
      setSubmitResult(result);
      setSuccessMessage('Submitted');
    } catch (err) {
      setError(err.message || 'Submission failed');
    } finally {
      setSubmitting(false);
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
      {successMessage && <p style={{ color: 'green' }}>{successMessage}</p>}

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

      <div style={{ marginTop: '1rem' }}>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!period || hasErrors || submitting}
        >
          {submitting ? 'Submitting…' : 'Submit to Paychex'}
        </button>
      </div>

      {submitResult && (
        <div style={{ marginTop: '1.5rem' }}>
          <h2>Submission Results</h2>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>Worker</th>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>Status</th>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>Check ID</th>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>Error</th>
              </tr>
            </thead>
            <tbody>
              {submitResult.map((row) => (
                <tr key={row.workerDbId || row.workerName}>
                  <td style={{ borderBottom: '1px solid #eee' }}>{row.workerName}</td>
                  <td style={{ borderBottom: '1px solid #eee' }}>{row.status}</td>
                  <td style={{ borderBottom: '1px solid #eee' }}>{row.checkId || '—'}</td>
                  <td style={{ borderBottom: '1px solid #eee', color: 'crimson' }}>
                    {row.error || '—'}
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
