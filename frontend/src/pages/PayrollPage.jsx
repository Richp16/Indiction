import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiGet } from '../api/client';
import PayrollExport from '../components/PayrollExport';
import PayPeriodSelector from '../components/PayPeriodSelector';

export default function PayrollPage() {
  const { token } = useAuth();
  const [periods, setPeriods] = useState([]);
  const [selectedPayPeriodId, setSelectedPayPeriodId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError('');
      try {
        const data = await apiGet('/api/payroll/pay-periods', token);
        const nextPeriods = data.periods || [];
        setPeriods(nextPeriods);

        const current =
          nextPeriods.find((period) => period.isCurrent) || nextPeriods[0] || null;
        setSelectedPayPeriodId((existing) => {
          if (existing && nextPeriods.some((period) => period.id === existing)) {
            return existing;
          }
          return current?.id || '';
        });
      } catch (err) {
        setError(err.message || 'Failed to load pay periods');
        setPeriods([]);
        setSelectedPayPeriodId('');
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

      <PayPeriodSelector
        periods={periods}
        selectedPayPeriodId={selectedPayPeriodId}
        onChange={setSelectedPayPeriodId}
      />

      {error && <p style={{ color: 'crimson' }}>{error}</p>}

      {selectedPayPeriodId && (
        <PayrollExport payPeriodId={selectedPayPeriodId} token={token} showInstructions />
      )}
    </div>
  );
}
