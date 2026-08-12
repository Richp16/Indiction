import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiGet, apiPost } from '../api/client';
import PayrollExport from '../components/PayrollExport';
import PayPeriodSelector from '../components/PayPeriodSelector';
import PaychexSyncButton from '../components/PaychexSyncButton';

export default function PayrollPage() {
  const { token, isAdmin } = useAuth();
  const [periods, setPeriods] = useState([]);
  const [selectedPayPeriodId, setSelectedPayPeriodId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadPeriods = useCallback(async () => {
    const data = await apiGet('/api/payroll/pay-periods', token);
    const nextPeriods = data.periods || [];
    setPeriods(nextPeriods);

    setSelectedPayPeriodId((existing) => {
      if (existing && nextPeriods.some((period) => period.id === existing)) {
        return existing;
      }
      const current =
        nextPeriods.find((period) => period.isCurrent) || nextPeriods[0] || null;
      return current?.id || '';
    });

    return nextPeriods;
  }, [token]);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError('');
      try {
        await loadPeriods();
      } catch (err) {
        setError(err.message || 'Failed to load pay periods');
        setPeriods([]);
        setSelectedPayPeriodId('');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [loadPeriods]);

  async function syncPayPeriods() {
    setError('');
    const result = await apiPost('/api/payroll/sync-pay-periods', {}, token);
    await loadPeriods();
    return result.message || 'Pay periods synced.';
  }

  if (loading) {
    return <p>Loading…</p>;
  }

  return (
    <div>
      <h1>Paychex Export</h1>

      {isAdmin && (
        <PaychexSyncButton
          label="Sync Pay Periods"
          token={token}
          syncType="pay_periods"
          onSync={syncPayPeriods}
        />
      )}

      <PayPeriodSelector
        periods={periods}
        selectedPayPeriodId={selectedPayPeriodId}
        onChange={setSelectedPayPeriodId}
      />

      {error && <p style={{ color: 'crimson' }}>{error}</p>}

      {selectedPayPeriodId && (
        <PayrollExport payPeriodId={selectedPayPeriodId} token={token} />
      )}
    </div>
  );
}

