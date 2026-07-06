import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiGet } from '../api/client';
import PayrollExport from '../components/PayrollExport';

export default function Summary() {
  const { token } = useAuth();
  const [period, setPeriod] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError('');
      try {
        const periodData = await apiGet('/api/pay-periods/current', token);
        setPeriod(periodData);
        const summary = await apiGet(
          `/api/summary?payPeriodId=${periodData.id}`,
          token
        );
        setRows(summary);
      } catch (err) {
        setError(err.message || 'Failed to load summary');
        setRows([]);
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

      {rows.length === 0 && !error && <p>No summary data for this pay period.</p>}

      {rows.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>Worker</th>
              <th style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>Job Site</th>
              <th style={{ textAlign: 'right', borderBottom: '1px solid #ccc' }}>Rate</th>
              <th style={{ textAlign: 'right', borderBottom: '1px solid #ccc' }}>Total Hours</th>
              <th style={{ textAlign: 'right', borderBottom: '1px solid #ccc' }}>Wages</th>
              <th style={{ textAlign: 'right', borderBottom: '1px solid #ccc' }}>Reimbursements</th>
              <th style={{ textAlign: 'right', borderBottom: '1px solid #ccc' }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const workerName =
                row.workerName || `${row.firstName || ''} ${row.lastName || ''}`.trim();
              const jobSiteName = row.jobSiteName || row.jobSite || '—';
              const totalHours = Number(row.totalHours) || 0;
              const standardRate = Number(row.standardRate) || 0;
              const totalReimbursement =
                (Number(row.truckReimbursement) || 0) +
                (Number(row.otherReimbursements) || 0);
              const wages = totalHours * standardRate;
              const total = Number(row.total) || wages + totalReimbursement;

              return (
                <tr key={`${workerName}-${jobSiteName}-${index}`}>
                  <td style={{ borderBottom: '1px solid #eee' }}>{workerName || '—'}</td>
                  <td style={{ borderBottom: '1px solid #eee' }}>{jobSiteName}</td>
                  <td style={{ textAlign: 'right', borderBottom: '1px solid #eee' }}>
                    {standardRate > 0 ? `$${standardRate.toFixed(2)}` : '—'}
                  </td>
                  <td style={{ textAlign: 'right', borderBottom: '1px solid #eee' }}>
                    {totalHours.toFixed(1)}
                  </td>
                  <td style={{ textAlign: 'right', borderBottom: '1px solid #eee' }}>
                    ${wages.toFixed(2)}
                  </td>
                  <td style={{ textAlign: 'right', borderBottom: '1px solid #eee' }}>
                    ${totalReimbursement.toFixed(2)}
                  </td>
                  <td style={{ textAlign: 'right', borderBottom: '1px solid #eee' }}>
                    ${total.toFixed(2)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {period && <PayrollExport payPeriodId={period.id} token={token} />}
    </div>
  );
}
