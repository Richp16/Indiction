import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiGet } from '../api/client';
import PayrollExport from '../components/PayrollExport';

export default function PayrollPage() {
  const { token } = useAuth();
  const [period, setPeriod] = useState(null);
  const [loading, setLoading] = useState(true);
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

  if (loading) {
    return <p>Loading…</p>;
  }

  return (
    <div>
      <h1>Payroll</h1>

      {period && (
        <p>
          Pay period: {period.start_date} – {period.end_date}
        </p>
      )}

      {error && <p style={{ color: 'crimson' }}>{error}</p>}

      {period && (
        <PayrollExport payPeriodId={period.id} token={token} showInstructions />
      )}
    </div>
  );
}
