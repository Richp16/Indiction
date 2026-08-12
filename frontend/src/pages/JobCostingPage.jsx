import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiGet } from '../api/client';
import PayPeriodSelector from '../components/PayPeriodSelector';
import { downloadFile } from '../utils/downloadFile';

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

function formatCurrency(value) {
  const amount = Number(value);
  return currencyFormatter.format(Number.isFinite(amount) ? amount : 0);
}

function escapeCsv(value) {
  const str = value == null ? '' : String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function sanitizeFilenamePart(value) {
  return String(value || 'Unknown')
    .replace(/[<>:"/\\|?*]+/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 80);
}

function buildJobCostingFilename(jobSiteName, payPeriodEnd) {
  const site = sanitizeFilenamePart(jobSiteName);
  const end = String(payPeriodEnd || '').split('T')[0] || 'period';
  return `JobCosting-${site}-${end}.csv`;
}

function buildJobCostingCsv(rows, summary) {
  const headers = [
    'Worker',
    'Worker ID',
    'Pay Component',
    'Pay Rate',
    'Hours Worked',
    'Amount',
  ];
  const lines = [headers.join(',')];

  for (const row of rows) {
    lines.push(
      [
        escapeCsv(row.worker),
        escapeCsv(row.workerId),
        escapeCsv(row.payComponent),
        escapeCsv(row.payRateDisplay ?? ''),
        escapeCsv(row.hoursDisplay ?? ''),
        escapeCsv(row.amountDisplay ?? ''),
      ].join(',')
    );
  }

  // Labeled totals rows (same pattern as Aging AP/AR export).
  lines.push('');
  lines.push(['Totals', '', '', '', '', ''].join(','));
  lines.push(
    ['Regular Gross Pay', '', '', '', '', escapeCsv(summary.regularEarnings)].join(',')
  );
  lines.push(
    ['Overtime Gross Pay', '', '', '', '', escapeCsv(summary.overtimeEarnings)].join(',')
  );
  lines.push(
    ['Total Gross Pay', '', '', '', '', escapeCsv(summary.totalEarnings)].join(',')
  );
  lines.push(
    [
      'Internal Reimbursements',
      '',
      '',
      '',
      '',
      escapeCsv(summary.internalReimbursements),
    ].join(',')
  );
  lines.push(
    [
      'Paychex Recurring Reimbursements',
      '',
      '',
      '',
      '',
      escapeCsv(summary.paychexRecurringReimbursements),
    ].join(',')
  );
  lines.push(
    [
      'Total Reimbursements',
      '',
      '',
      '',
      '',
      escapeCsv(summary.totalReimbursements),
    ].join(',')
  );
  lines.push(
    ['Employer Liability Cost', '', '', '', '', escapeCsv(summary.employerLiability)].join(
      ','
    )
  );
  lines.push(
    ['Cash Requirements', '', '', '', '', escapeCsv(summary.cashRequirements)].join(',')
  );

  return `${lines.join('\n')}\n`;
}

const emptySummary = {
  totalEarnings: 0,
  regularEarnings: 0,
  overtimeEarnings: 0,
  totalReimbursements: 0,
  internalReimbursements: 0,
  paychexRecurringReimbursements: 0,
  employerLiability: 0,
  cashRequirements: 0,
};

export default function JobCostingPage() {
  const { token } = useAuth();
  const [periods, setPeriods] = useState([]);
  const [selectedPayPeriodId, setSelectedPayPeriodId] = useState('');
  const [jobSites, setJobSites] = useState([]);
  const [selectedJobSiteId, setSelectedJobSiteId] = useState('');
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(emptySummary);
  const [jobSiteMeta, setJobSiteMeta] = useState(null);
  const [payPeriodMeta, setPayPeriodMeta] = useState(null);
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [loadingReport, setLoadingReport] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');

  const selectedPeriod = useMemo(
    () => periods.find((period) => period.id === selectedPayPeriodId) || null,
    [periods, selectedPayPeriodId]
  );

  const loadMeta = useCallback(async () => {
    setLoadingMeta(true);
    setError('');
    try {
      const [periodsData, sitesData] = await Promise.all([
        apiGet('/api/payroll/pay-periods', token),
        apiGet('/api/job-sites', token),
      ]);
      const nextPeriods = periodsData.periods || [];
      setPeriods(nextPeriods);
      setJobSites((sitesData || []).filter((site) => site.is_active !== false));

      setSelectedPayPeriodId((existing) => {
        if (existing && nextPeriods.some((period) => period.id === existing)) {
          return existing;
        }
        const current =
          nextPeriods.find((period) => period.isCurrent) || nextPeriods[0] || null;
        return current?.id || '';
      });
    } catch (err) {
      setError(err.message || 'Failed to load selectors');
      setPeriods([]);
      setJobSites([]);
      setSelectedPayPeriodId('');
    } finally {
      setLoadingMeta(false);
    }
  }, [token]);

  useEffect(() => {
    loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    if (!token || !selectedPayPeriodId || !selectedJobSiteId) {
      setRows([]);
      setSummary(emptySummary);
      setJobSiteMeta(null);
      setPayPeriodMeta(null);
      return undefined;
    }

    let cancelled = false;

    async function loadReport() {
      setLoadingReport(true);
      setError('');
      try {
        const params = new URLSearchParams({
          payPeriodId: selectedPayPeriodId,
          jobSiteId: selectedJobSiteId,
        });
        const data = await apiGet(`/api/job-costing?${params.toString()}`, token);
        if (cancelled) return;
        setRows(data.rows || []);
        setSummary(data.summary || emptySummary);
        setJobSiteMeta(data.jobSite || null);
        setPayPeriodMeta(data.payPeriod || null);
      } catch (err) {
        if (cancelled) return;
        setError(err.message || 'Failed to load job costing');
        setRows([]);
        setSummary(emptySummary);
        setJobSiteMeta(null);
        setPayPeriodMeta(null);
      } finally {
        if (!cancelled) setLoadingReport(false);
      }
    }

    loadReport();
    return () => {
      cancelled = true;
    };
  }, [token, selectedPayPeriodId, selectedJobSiteId]);

  async function handleExport() {
    if (!rows.length && !summary) return;
    setExporting(true);
    setError('');
    try {
      const csv = buildJobCostingCsv(rows, summary);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const filename = buildJobCostingFilename(
        jobSiteMeta?.name,
        payPeriodMeta?.end_date ||
          payPeriodMeta?.endDate ||
          selectedPeriod?.endDate ||
          selectedPeriod?.end_date
      );
      const result = await downloadFile(blob, filename, 'text/csv');
      if (!result.success && !result.cancelled) {
        setError('Download failed');
      }
    } catch (err) {
      setError(err.message || 'Download failed');
    } finally {
      setExporting(false);
    }
  }

  if (loadingMeta) {
    return <p>Loading…</p>;
  }

  return (
    <div>
      <h1>Job Costing</h1>
      <p style={{ color: '#555', maxWidth: 720 }}>
        Hours and rates for one job site and pay period, broken out by pay component
        the same way as Paychex SPI (Hourly, Overtime, Reimbursement).
      </p>

      <PayPeriodSelector
        periods={periods}
        selectedPayPeriodId={selectedPayPeriodId}
        onChange={setSelectedPayPeriodId}
      />

      <div style={toolbarStyle}>
        <label style={labelStyle}>
          Job site
          <select
            aria-label="Job site"
            value={selectedJobSiteId}
            onChange={(event) => setSelectedJobSiteId(event.target.value)}
            style={selectStyle}
          >
            <option value="">Select job site</option>
            {jobSites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && <p style={{ color: 'crimson' }}>{error}</p>}

      {!selectedJobSiteId && (
        <p style={{ color: '#666' }}>Select a job site to view costing.</p>
      )}

      {selectedJobSiteId && loadingReport && <p>Loading job costing…</p>}

      {selectedJobSiteId && !loadingReport && (
        <>
          <div style={{ marginBottom: '1rem' }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleExport}
              disabled={
                exporting ||
                (rows.length === 0 &&
                  !summary.totalEarnings &&
                  !summary.totalReimbursements)
              }
            >
              {exporting ? 'Exporting…' : 'Export CSV'}
            </button>
          </div>

          <section style={statsSectionStyle}>
            <div style={statCardStyle}>
              <h2 style={statTitleStyle}>Gross Pay</h2>
              <div style={breakdownRowStyle}>
                <span>Regular</span>
                <strong>{formatCurrency(summary.regularEarnings)}</strong>
              </div>
              <div style={breakdownRowStyle}>
                <span>Overtime</span>
                <strong>{formatCurrency(summary.overtimeEarnings)}</strong>
              </div>
              <div style={breakdownTotalRowStyle}>
                <span>Total Gross Pay</span>
                <strong style={statValueStyle}>
                  {formatCurrency(summary.totalEarnings)}
                </strong>
              </div>
              <p style={statSubtextStyle}>
                Regular includes straight-time and PTO. Overtime includes OT and
                doubletime. Excludes reimbursements.
              </p>
            </div>
            <div style={statCardStyle}>
              <h2 style={statTitleStyle}>Total Reimbursements</h2>
              <p style={statValueStyle}>{formatCurrency(summary.totalReimbursements)}</p>
              <p style={statSubtextStyle}>
                Internal (Daily Entry): {formatCurrency(summary.internalReimbursements)}
                <br />
                Paychex recurring: {formatCurrency(summary.paychexRecurringReimbursements)}
              </p>
            </div>
            <div style={statCardStyle}>
              <h2 style={statTitleStyle}>Employer Liability Cost</h2>
              <p style={statValueStyle}>{formatCurrency(summary.employerLiability)}</p>
              <p style={statSubtextStyle}>
                Estimated employer liabilities at 8% of total earnings.
              </p>
            </div>
            <div style={statCardStyle} className="summary-kpi-cash">
              <h2 style={statTitleStyle}>Cash Requirements</h2>
              <p style={statValueStyle}>{formatCurrency(summary.cashRequirements)}</p>
              <p style={statSubtextStyle}>
                Total Gross Pay + Total Reimbursements + Employer Liability Cost.
              </p>
            </div>
          </section>

          <div style={{ overflowX: 'auto' }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Worker</th>
                  <th style={thStyle}>Worker ID</th>
                  <th style={thStyle}>Pay Component</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Pay Rate</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Hours Worked</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={tdStyle}>
                      No time entries for this job site and pay period.
                    </td>
                  </tr>
                ) : (
                  rows.map((row, index) => (
                    <tr key={`${row.workerDbId}-${row.payComponent}-${index}`}>
                      <td style={tdStyle}>{row.worker}</td>
                      <td style={tdStyle}>{row.workerId}</td>
                      <td style={tdStyle}>{row.payComponent}</td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>
                        {row.payRateDisplay || ''}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>
                        {row.hoursDisplay || ''}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>
                        {row.amountDisplay || ''}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

const toolbarStyle = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '0.75rem',
  alignItems: 'center',
  marginBottom: '0.75rem',
};

const labelStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.35rem',
  fontSize: '0.875rem',
  fontWeight: 600,
  color: '#444',
};

const selectStyle = {
  minWidth: 260,
  padding: '0.5rem 0.75rem',
  border: '1px solid #d4d1ca',
  borderRadius: 6,
  background: '#fff',
  fontWeight: 400,
};

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

const tableStyle = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '0.9rem',
};

const thStyle = {
  textAlign: 'left',
  borderBottom: '2px solid #ddd',
  padding: '0.5rem 0.75rem',
  whiteSpace: 'nowrap',
};

const tdStyle = {
  borderBottom: '1px solid #eee',
  padding: '0.5rem 0.75rem',
};
