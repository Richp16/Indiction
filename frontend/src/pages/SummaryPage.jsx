import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { useAppConfig } from '../context/AppConfigContext';
import { apiGet, apiPost } from '../api/client';
import PayPeriodSelector from '../components/PayPeriodSelector';
import PaychexSyncButton from '../components/PaychexSyncButton';

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

function formatCurrency(value) {
  const amount = Number(value);
  return currencyFormatter.format(Number.isFinite(amount) ? amount : 0);
}

export default function SummaryPage() {
  const { token } = useAuth();
  const { paychexEnabled, capabilities } = useAppConfig();
  const [periods, setPeriods] = useState([]);
  const [selectedPayPeriodId, setSelectedPayPeriodId] = useState('');
  const [totalEarnings, setTotalEarnings] = useState(0);
  const [regularEarnings, setRegularEarnings] = useState(0);
  const [overtimeEarnings, setOvertimeEarnings] = useState(0);
  const [totalReimbursements, setTotalReimbursements] = useState(0);
  const [internalReimbursements, setInternalReimbursements] = useState(0);
  const [paychexRecurringReimbursements, setPaychexRecurringReimbursements] =
    useState(0);
  const [employerLiability, setEmployerLiability] = useState(0);
  const [periodsLoading, setPeriodsLoading] = useState(true);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [error, setError] = useState('');

  const selectedPeriod = useMemo(
    () => periods.find((period) => period.id === selectedPayPeriodId) || null,
    [periods, selectedPayPeriodId]
  );

  const cashRequirements = totalEarnings + totalReimbursements + employerLiability;

  function applyAnalysis(analysis) {
    setTotalEarnings(analysis.totalEarnings ?? 0);
    setRegularEarnings(analysis.regularEarnings ?? 0);
    setOvertimeEarnings(analysis.overtimeEarnings ?? 0);
    setTotalReimbursements(analysis.totalReimbursements ?? 0);
    setInternalReimbursements(analysis.internalReimbursements ?? 0);
    setPaychexRecurringReimbursements(
      analysis.paychexRecurringReimbursements ?? 0
    );
    setEmployerLiability(analysis.employerLiability ?? 0);
  }

  function clearAnalysis() {
    setTotalEarnings(0);
    setRegularEarnings(0);
    setOvertimeEarnings(0);
    setTotalReimbursements(0);
    setInternalReimbursements(0);
    setPaychexRecurringReimbursements(0);
    setEmployerLiability(0);
  }

  useEffect(() => {
    async function loadPeriods() {
      setPeriodsLoading(true);
      setError('');
      try {
        const data = await apiGet('/api/pay-periods', token);
        const nextPeriods = Array.isArray(data) ? data : data.periods || [];
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
        setPeriodsLoading(false);
      }
    }
    loadPeriods();
  }, [token]);

  useEffect(() => {
    if (!token || !selectedPeriod) {
      clearAnalysis();
      return undefined;
    }

    let cancelled = false;

    async function loadAnalysis() {
      setAnalysisLoading(true);
      setError('');
      try {
        const params = new URLSearchParams({
          periodStart: selectedPeriod.startDate || selectedPeriod.start_date,
          periodEnd: selectedPeriod.endDate || selectedPeriod.end_date,
        });
        const analysis = await apiGet(`/api/summary/analysis?${params.toString()}`, token);
        if (cancelled) return;
        applyAnalysis(analysis);
      } catch (err) {
        if (cancelled) return;
        setError(err.message || 'Failed to load summary');
        clearAnalysis();
      } finally {
        if (!cancelled) setAnalysisLoading(false);
      }
    }

    loadAnalysis();
    return () => {
      cancelled = true;
    };
  }, [token, selectedPeriod]);

  async function syncRecurringReimbursements() {
    setError('');
    const result = await apiPost(
      '/api/paychex/sync-recurring-reimbursements',
      {},
      token
    );

    if (selectedPeriod) {
      const params = new URLSearchParams({
        periodStart: selectedPeriod.startDate || selectedPeriod.start_date,
        periodEnd: selectedPeriod.endDate || selectedPeriod.end_date,
      });
      const analysis = await apiGet(
        `/api/summary/analysis?${params.toString()}`,
        token
      );
      applyAnalysis(analysis);
    }

    return result.message || 'Recurring reimbursements synced.';
  }

  if (periodsLoading) {
    return <p>Loading…</p>;
  }

  return (
    <div>
      <h1>Summary</h1>

      <PayPeriodSelector
        periods={periods}
        selectedPayPeriodId={selectedPayPeriodId}
        onChange={setSelectedPayPeriodId}
      />

      {capabilities?.supportsProviderSync && (
        <PaychexSyncButton
          label="Sync Paychex recurring reimbursements"
          token={token}
          syncType="recurring_reimbursements"
          onSync={syncRecurringReimbursements}
        />
      )}

      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      {analysisLoading && <p>Loading analysis…</p>}

      <section style={statsSectionStyle}>
        <div style={statCardStyle}>
          <h2 style={statTitleStyle}>Gross Pay</h2>
          <div style={breakdownRowStyle}>
            <span>Regular</span>
            <strong>{formatCurrency(regularEarnings)}</strong>
          </div>
          <div style={breakdownRowStyle}>
            <span>Overtime</span>
            <strong>{formatCurrency(overtimeEarnings)}</strong>
          </div>
          <div style={breakdownTotalRowStyle}>
            <span>Total Gross Pay</span>
            <strong style={statValueStyle}>{formatCurrency(totalEarnings)}</strong>
          </div>
        </div>
        <div style={statCardStyle}>
          <h2 style={statTitleStyle}>Total Reimbursements</h2>
          <p style={statValueStyle}>{formatCurrency(totalReimbursements)}</p>
          <p style={statSubtextStyle}>
            Internal (Daily Entry): {formatCurrency(internalReimbursements)}
            {paychexEnabled && (
              <>
                <br />
                Recurring (provider sync): {formatCurrency(paychexRecurringReimbursements)}
              </>
            )}
          </p>
        </div>
        <div style={statCardStyle}>
          <h2 style={statTitleStyle}>Employer Liability Cost</h2>
          <p style={statValueStyle}>{formatCurrency(employerLiability)}</p>
        </div>
        <div style={statCardStyle} className="summary-kpi-cash">
          <h2 style={statTitleStyle}>Cash Requirements</h2>
          <p style={statValueStyle}>{formatCurrency(cashRequirements)}</p>
        </div>
      </section>
    </div>
  );
}

const statsSectionStyle = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '1rem',
  margin: '1.5rem 0 2rem',
};

const statCardStyle = {
  flex: '1 1 280px',
  padding: '1rem',
  background: '#f7f7f7',
  borderRadius: 6,
};

const statTitleStyle = {
  margin: '0 0 0.5rem',
  fontSize: '1rem',
  fontWeight: 600,
};

const statValueStyle = {
  margin: 0,
  fontSize: '1.75rem',
  fontWeight: 700,
};

const breakdownRowStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'baseline',
  gap: '0.75rem',
  margin: '0.25rem 0',
  fontSize: '0.95rem',
};

const breakdownTotalRowStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'baseline',
  gap: '0.75rem',
  margin: '0.75rem 0 0',
  paddingTop: '0.5rem',
  borderTop: '1px solid #ddd',
};

const statSubtextStyle = {
  margin: '0.5rem 0 0',
  fontSize: '0.875rem',
  color: '#666',
};
