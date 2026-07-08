import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiGet } from '../api/client';

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

function formatCurrency(value) {
  const amount = Number(value);
  return currencyFormatter.format(Number.isFinite(amount) ? amount : 0);
}

function formatWorkerName(entry) {
  const name = `${entry.worker_first_name || ''} ${entry.worker_last_name || ''}`.trim();
  return name || '—';
}

function formatPayCode(entry) {
  return entry.paychex_component_id || entry.component_name || '—';
}

function formatHours(entry) {
  const hours = Number(entry.hours);
  if (Number.isFinite(hours) && hours > 0) {
    return hours.toFixed(1);
  }
  const amount = Number(entry.reimbursement_amount);
  if (Number.isFinite(amount) && amount > 0) {
    return `$${amount.toFixed(2)}`;
  }
  return '—';
}

export default function SummaryPage() {
  const { token } = useAuth();
  const [period, setPeriod] = useState(null);
  const [entries, setEntries] = useState([]);
  const [totalEarnings, setTotalEarnings] = useState(0);
  const [employerLiability, setEmployerLiability] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError('');
      try {
        const periodData = await apiGet('/api/pay-periods/current', token);
        setPeriod(periodData);

        const [entryData, summaryData] = await Promise.all([
          apiGet(`/api/entries?payPeriodId=${periodData.id}`, token),
          apiGet(`/api/summary?payPeriodId=${periodData.id}`, token),
        ]);

        setEntries(entryData);
        setTotalEarnings(summaryData.totalEarnings ?? 0);
        setEmployerLiability(summaryData.employerLiability ?? 0);
      } catch (err) {
        setError(err.message || 'Failed to load summary');
        setEntries([]);
        setTotalEarnings(0);
        setEmployerLiability(0);
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
      <h1>Summary</h1>

      {period && (
        <p>
          Pay period: {period.start_date} – {period.end_date}
        </p>
      )}

      {error && <p style={{ color: 'crimson' }}>{error}</p>}

      <section style={statsSectionStyle}>
        <div style={statCardStyle}>
          <h2 style={statTitleStyle}>Company Total Earnings</h2>
          <p style={statValueStyle}>{formatCurrency(totalEarnings)}</p>
          <p style={statSubtextStyle}>
            Includes regular, overtime, and PTO. Excludes reimbursements.
          </p>
        </div>
        <div style={statCardStyle}>
          <h2 style={statTitleStyle}>Employer Liability Cost</h2>
          <p style={statValueStyle}>{formatCurrency(employerLiability)}</p>
          <p style={statSubtextStyle}>
            Estimated employer liabilities at 8% of total earnings.
          </p>
        </div>
      </section>

      {entries.length === 0 && !error && (
        <p>No time entries for this pay period.</p>
      )}

      {entries.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>Worker</th>
              <th style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>Job Site</th>
              <th style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>Date</th>
              <th style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>Pay Code</th>
              <th style={{ textAlign: 'right', borderBottom: '1px solid #ccc' }}>Hours</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td style={{ borderBottom: '1px solid #eee' }}>{formatWorkerName(entry)}</td>
                <td style={{ borderBottom: '1px solid #eee' }}>{entry.job_site_name || '—'}</td>
                <td style={{ borderBottom: '1px solid #eee' }}>{entry.entry_date || '—'}</td>
                <td style={{ borderBottom: '1px solid #eee' }}>{formatPayCode(entry)}</td>
                <td style={{ textAlign: 'right', borderBottom: '1px solid #eee' }}>
                  {formatHours(entry)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
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
  borderRadius: 4,
};

const statTitleStyle = {
  margin: '0 0 0.5rem',
  fontSize: '1rem',
  fontWeight: 600,
};

const statValueStyle = {
  margin: '0 0 0.5rem',
  fontSize: '1.75rem',
  fontWeight: 700,
};

const statSubtextStyle = {
  margin: 0,
  color: '#666',
  fontSize: '0.875rem',
};
