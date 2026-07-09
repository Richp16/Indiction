import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiGet, apiPatch, apiPostDownload } from '../api/client';

function formatWeekRange(startDate, endDate) {
  const start = new Date(`${startDate}T12:00:00`);
  const end = new Date(`${endDate}T12:00:00`);
  const startLabel = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const endLabel = end.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  return `${startLabel} – ${endLabel}`;
}

function buildWeekOptions(period) {
  if (!period) return [];
  const options = [];
  if (period.week1_start && period.week1_end) {
    options.push({
      label: `Week 1 — ${formatWeekRange(period.week1_start, period.week1_end)}`,
      value: period.week1_end,
    });
  }
  if (period.week2_start && period.week2_end) {
    options.push({
      label: `Week 2 — ${formatWeekRange(period.week2_start, period.week2_end)}`,
      value: period.week2_end,
    });
  }
  return options;
}

function defaultWeekEnding(weekOptions) {
  if (!weekOptions.length) return '';
  const today = new Date().toISOString().split('T')[0];
  const completed = weekOptions.filter((option) => option.value <= today);
  if (completed.length) {
    return completed[completed.length - 1].value;
  }
  return weekOptions[0].value;
}

function normalizeWorkerType(value) {
  return value === 'RA' ? 'RA' : 'J';
}

function formatSiteLabel(site) {
  if (!site) return '';
  const code = site.job_code ? ` (${site.job_code})` : '';
  return `${site.name}${code}`;
}

const pageStyle = {
  padding: '0 0.5rem 2rem',
};

const toolbarStyle = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '0.75rem',
  alignItems: 'center',
  marginBottom: '1.5rem',
};

const selectStyle = {
  minWidth: 220,
  padding: '0.5rem 0.75rem',
  border: '1px solid #d4d1ca',
  borderRadius: 6,
  background: '#fff',
};

const exportButtonStyle = {
  padding: '0.5rem 1rem',
  border: 'none',
  borderRadius: 6,
  background: '#01696f',
  color: '#fff',
  cursor: 'pointer',
  fontWeight: 600,
};

const sectionStyle = {
  background: '#fff',
  border: '1px solid #e5e2dc',
  borderRadius: 8,
  padding: '1.25rem',
  marginBottom: '1.5rem',
  boxShadow: '0 1px 2px rgba(40, 37, 29, 0.06)',
};

const sectionTitleStyle = {
  margin: '0 0 1rem',
  fontSize: '1.125rem',
  fontWeight: 600,
};

const tableWrapStyle = {
  overflowX: 'auto',
};

const tableStyle = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '0.9rem',
};

const thStyle = {
  textAlign: 'left',
  padding: '0.6rem 0.75rem',
  borderBottom: '2px solid #d4d1ca',
  background: '#f3f0ec',
  fontWeight: 700,
  whiteSpace: 'nowrap',
};

const thRightStyle = { ...thStyle, textAlign: 'right' };

const tdStyle = {
  padding: '0.6rem 0.75rem',
  borderBottom: '1px solid #ece9e4',
  verticalAlign: 'middle',
};

const tdRightStyle = { ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };

const workerNameCellStyle = {
  ...tdStyle,
  minWidth: 160,
  textAlign: 'left',
};

const badgeStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 28,
  height: 22,
  borderRadius: 999,
  border: '1px solid #c9c5be',
  background: '#f7f6f2',
  fontSize: '0.75rem',
  fontWeight: 700,
  cursor: 'pointer',
  padding: 0,
};

export default function CertifiedPayrollPage() {
  const { token } = useAuth();
  const [sites, setSites] = useState([]);
  const [selectedSite, setSelectedSite] = useState('');
  const [weekOptions, setWeekOptions] = useState([]);
  const [weekEndingDate, setWeekEndingDate] = useState('');
  const [hoursRows, setHoursRows] = useState([]);
  const [suppRows, setSuppRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function loadBase() {
      setLoading(true);
      setError('');
      try {
        const [sitesData, period] = await Promise.all([
          apiGet('/api/job-sites', token),
          apiGet('/api/pay-periods/current', token),
        ]);
        const active = (sitesData || []).filter((site) => site.is_active !== false);
        setSites(active);
        if (!selectedSite && active[0]) {
          setSelectedSite(active[0].id);
        }

        const options = buildWeekOptions(period);
        setWeekOptions(options);
        if (options.length) {
          setWeekEndingDate((current) => current || defaultWeekEnding(options));
        }
      } catch (err) {
        setError(err.message || 'Failed to load page data');
      } finally {
        setLoading(false);
      }
    }
    loadBase();
  }, [token]);

  useEffect(() => {
    if (!selectedSite || !weekEndingDate || !token) return;

    async function loadData() {
      setError('');
      try {
        const [hours, supplements] = await Promise.all([
          apiGet(
            `/api/certified-payroll/hours?jobSiteId=${selectedSite}&weekEndingDate=${weekEndingDate}`,
            token
          ),
          apiGet(
            `/api/certified-payroll/supplements?jobSiteId=${selectedSite}&weekEndingDate=${weekEndingDate}`,
            token
          ),
        ]);
        setHoursRows(hours.rows || []);
        setSuppRows(supplements.rows || []);
      } catch (err) {
        setError(err.message || 'Failed to load certified payroll data');
        setHoursRows([]);
        setSuppRows([]);
      }
    }

    loadData();
  }, [selectedSite, weekEndingDate, token]);

  const grouped = useMemo(() => {
    const map = new Map();
    for (const row of hoursRows) {
      if (!map.has(row.id)) {
        map.set(row.id, {
          workerId: row.id,
          workerName: `${row.last_name || ''}, ${row.first_name || ''}`,
          classification: row.labor_classification || '',
          workerType: normalizeWorkerType(row.worker_type),
          rate: Number(row.pay_rate) || 0,
          entries: [],
        });
      }
      map.get(row.id).entries.push(row);
    }
    return [...map.values()];
  }, [hoursRows]);

  async function toggleWorkerType(workerId, currentType) {
    const nextType = currentType === 'J' ? 'RA' : 'J';
    setHoursRows((rows) =>
      rows.map((row) =>
        row.id === workerId ? { ...row, worker_type: nextType } : row
      )
    );
    try {
      await apiPatch(`/api/workers/${workerId}`, { worker_type: nextType }, token);
    } catch (err) {
      setHoursRows((rows) =>
        rows.map((row) =>
          row.id === workerId ? { ...row, worker_type: currentType } : row
        )
      );
      setError(err.message || 'Failed to update worker type');
    }
  }

  async function exportPdf() {
    const site = sites.find((s) => s.id === selectedSite);
    const { blob, filename } = await apiPostDownload(
      '/api/certified-payroll/export',
      { jobSiteId: selectedSite, weekEndingDate },
      token
    );
    const downloadName = filename || `WH347-${site?.job_code || 'site'}-${weekEndingDate}.pdf`;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = downloadName;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }

  if (loading) {
    return <p style={pageStyle}>Loading…</p>;
  }

  return (
    <div style={pageStyle}>
      <style>
        {`
          .wh347-supplement-table .supplement-input {
            width: 100%;
            min-width: 72px;
            padding: 4px 6px;
            border: 1px solid #d1d5db;
            border-radius: 4px;
            background: white;
            font-size: inherit;
            box-sizing: border-box;
          }

          .wh347-supplement-table .supplement-input:focus {
            border-color: #2563eb;
            outline: none;
            box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.15);
          }
        `}
      </style>
      <h1 style={{ marginBottom: '1rem' }}>Certified Payroll</h1>

      {error && <p style={{ color: 'crimson', marginBottom: '1rem' }}>{error}</p>}

      <div style={toolbarStyle}>
        <select
          value={selectedSite}
          onChange={(e) => setSelectedSite(e.target.value)}
          style={selectStyle}
          aria-label="Job site"
        >
          <option value="">Select job site</option>
          {sites.map((site) => (
            <option key={site.id} value={site.id}>
              {formatSiteLabel(site)}
            </option>
          ))}
        </select>

        <select
          value={weekEndingDate}
          onChange={(e) => setWeekEndingDate(e.target.value)}
          style={selectStyle}
          aria-label="Pay week"
          disabled={weekOptions.length === 0}
        >
          {weekOptions.length === 0 ? (
            <option value="">No weeks available</option>
          ) : (
            weekOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))
          )}
        </select>

        <button
          type="button"
          style={exportButtonStyle}
          onClick={() => exportPdf().catch((err) => setError(err.message))}
          disabled={!selectedSite || !weekEndingDate}
        >
          Export WH-347 PDF
        </button>
      </div>

      <section style={sectionStyle}>
        <h2 style={sectionTitleStyle}>Daily Hour Log</h2>
        <div style={tableWrapStyle}>
          <table style={tableStyle} className="wh347-supplement-table">
            <thead>
              <tr>
                <th style={thStyle}>Worker Name</th>
                <th style={thStyle}>Classification</th>
                <th style={{ ...thStyle, textAlign: 'center' }}>J/RA</th>
                <th style={thRightStyle}>Total ST</th>
                <th style={thRightStyle}>Total OT</th>
                <th style={thRightStyle}>Rate</th>
                <th style={thRightStyle}>Gross This Job</th>
              </tr>
            </thead>
            <tbody>
              {grouped.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ ...tdStyle, color: '#666' }}>
                    No hour entries for this week and job site.
                  </td>
                </tr>
              )}
              {grouped.map((row) => {
                const totalSt = row.entries
                  .filter((e) => !['OT', 'OVERTIME', 'Overtime'].includes(e.paychex_component_id))
                  .reduce((acc, e) => acc + Number(e.hours || 0), 0);
                const totalOt = row.entries
                  .filter((e) => ['OT', 'OVERTIME', 'Overtime'].includes(e.paychex_component_id))
                  .reduce((acc, e) => acc + Number(e.hours || 0), 0);
                const gross = totalSt * row.rate + totalOt * row.rate * 1.5;
                return (
                  <tr key={row.workerId}>
                    <td style={workerNameCellStyle}>{row.workerName}</td>
                    <td style={tdStyle}>{row.classification}</td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>
                      <button
                        type="button"
                        style={badgeStyle}
                        title="Toggle J/RA"
                        onClick={() => toggleWorkerType(row.workerId, row.workerType)}
                      >
                        {row.workerType}
                      </button>
                    </td>
                    <td style={tdRightStyle}>{totalSt.toFixed(2)}</td>
                    <td style={tdRightStyle}>{totalOt.toFixed(2)}</td>
                    <td style={tdRightStyle}>{row.rate.toFixed(2)}</td>
                    <td style={tdRightStyle}>{gross.toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section style={sectionStyle}>
        <h2 style={sectionTitleStyle}>WH-347 Supplement</h2>
        <div style={tableWrapStyle}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={{ ...thStyle, minWidth: 160 }}>Worker Name</th>
                <th style={thStyle}>Wage Det. No.</th>
                <th style={thStyle}>Fringe Credit</th>
                <th style={thStyle}>Fringe in Lieu</th>
                <th style={thStyle}>Gross All Work</th>
                <th style={thStyle}>Withholding</th>
                <th style={thStyle}>FICA</th>
                <th style={thStyle}>Other</th>
                <th style={thStyle}>Other Label</th>
                <th style={thStyle}>Net Pay</th>
              </tr>
            </thead>
            <tbody>
              {suppRows.length === 0 && (
                <tr>
                  <td colSpan={10} style={{ ...tdStyle, color: '#666' }}>
                    No supplement rows for this week and job site.
                  </td>
                </tr>
              )}
              {suppRows.map((row) => (
                <tr key={row.worker_id}>
                  <td style={workerNameCellStyle}>{row.worker_name}</td>
                  {[
                    'wage_determination_no',
                    'fringe_benefit_credit',
                    'fringe_paid_in_lieu',
                    'gross_earned_all_work',
                    'deduction_withholding',
                    'deduction_fica',
                    'deduction_other',
                    'deduction_other_label',
                    'net_pay',
                  ].map((field) => (
                    <td key={field} style={tdStyle}>
                      <input
                        className="supplement-input"
                        value={row[field] ?? ''}
                        onChange={(e) => {
                          const value = e.target.value;
                          setSuppRows((all) =>
                            all.map((r) =>
                              r.worker_id === row.worker_id ? { ...r, [field]: value } : r
                            )
                          );
                        }}
                        onBlur={(e) => {
                          const value = e.target.value;
                          apiPatch(
                            '/api/certified-payroll/supplements',
                            {
                              workerId: row.worker_id,
                              jobSiteId: selectedSite,
                              weekEndingDate,
                              ...row,
                              [field]: value,
                            },
                            token
                          ).catch((err) => setError(err.message));
                        }}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
