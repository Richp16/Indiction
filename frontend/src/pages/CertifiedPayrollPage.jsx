import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiPatch, apiPost, apiPostDownload } from '../api/client';
import DailyHourLogSkeleton from './certifiedPayroll/DailyHourLogSkeleton';
import Wh347SupplementSkeleton from './certifiedPayroll/Wh347SupplementSkeleton';
import { useCertifiedPayrollData } from './certifiedPayroll/useCertifiedPayrollData';
import {
  sectionStyle,
  sectionTitleStyle,
  tableWrapStyle,
  tableStyle,
  thStyle,
  thRightStyle,
  tdStyle,
  tdRightStyle,
  workerNameCellStyle,
} from './certifiedPayroll/certifiedPayrollTableStyles';

const MONEY_FIELDS = new Set([
  'fringe_benefit_credit',
  'fringe_paid_in_lieu',
  'gross_earned_all_work',
  'deduction_withholding',
  'deduction_fica',
  'deduction_other',
  'net_pay',
]);

function normalizeWorkerType(value) {
  return value === 'RA' ? 'RA' : 'J';
}

function formatSiteLabel(site) {
  if (!site) return '';
  const code = site.job_code ? ` (${site.job_code})` : '';
  return `${site.name}${code}`;
}

const pageStyle = { padding: '0 0.5rem 2rem' };

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

const primaryButtonStyle = {
  padding: '0.5rem 1rem',
  border: 'none',
  borderRadius: 6,
  background: '#01696f',
  color: '#fff',
  cursor: 'pointer',
  fontWeight: 600,
};

const secondaryButtonStyle = {
  padding: '0.5rem 0.875rem',
  border: '1px solid #d4d1ca',
  borderRadius: 6,
  background: '#fff',
  color: '#444',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.5rem',
};

const estimatedBadgeStyle = {
  display: 'inline-block',
  marginLeft: '0.75rem',
  padding: '0.2rem 0.5rem',
  borderRadius: 999,
  background: '#fef3c7',
  color: '#92400e',
  fontSize: '0.75rem',
  fontWeight: 600,
  verticalAlign: 'middle',
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

const savedStyle = {
  marginLeft: '0.75rem',
  color: '#15803d',
  fontSize: '0.8rem',
  fontWeight: 500,
};

const resyncStatusStyle = {
  marginBottom: '1rem',
  color: '#7a7974',
  fontSize: '0.875rem',
};

export default function CertifiedPayrollPage() {
  const { token } = useAuth();
  const {
    sites,
    payPeriods,
    selectedSite,
    setSelectedSite,
    selectedPayPeriodId,
    setSelectedPayPeriodId,
    selectedWeek,
    setSelectedWeek,
    selectedPeriod,
    weekEndingDate,
    hoursRows,
    setHoursRows,
    suppRows,
    setSuppRows,
    hasEstimated,
    setHasEstimated,
    isLoadingPageData,
    loadError,
  } = useCertifiedPayrollData(token);

  const [isResyncing, setIsResyncing] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [savedWorkerId, setSavedWorkerId] = useState('');
  const [a11yStatus, setA11yStatus] = useState('');

  useEffect(() => {
    if (isLoadingPageData) {
      setA11yStatus('Loading certified payroll data…');
    } else if (sites.length > 0 || payPeriods.length > 0 || loadError) {
      setA11yStatus('Certified payroll data loaded.');
    }
  }, [isLoadingPageData, sites.length, payPeriods.length, loadError]);

  const displayError = error || loadError;

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
      rows.map((row) => (row.id === workerId ? { ...row, worker_type: nextType } : row))
    );
    try {
      await apiPatch(`/api/workers/${workerId}`, { worker_type: nextType }, token);
    } catch (err) {
      setHoursRows((rows) =>
        rows.map((row) => (row.id === workerId ? { ...row, worker_type: currentType } : row))
      );
      setError(err.message || 'Failed to update worker type');
    }
  }

  async function exportPdf() {
    const site = sites.find((s) => s.id === selectedSite);
    const { blob, filename } = await apiPostDownload(
      '/api/certified-payroll/export',
      { jobSiteId: selectedSite, weekEndingDate, payPeriodId: selectedPayPeriodId },
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

  async function resyncFromPaychex() {
    if (!selectedSite || !selectedPayPeriodId || !weekEndingDate || !selectedPeriod) return;
    setIsResyncing(true);
    setError('');
    setSuccessMessage('');
    try {
      const result = await apiPost(
        '/api/certified-payroll/resync',
        {
          jobSiteId: selectedSite,
          payPeriodId: selectedPayPeriodId,
          weekEndingDate,
          week1End: selectedPeriod.week1End,
          week2End: selectedPeriod.week2End,
        },
        token
      );
      setSuppRows(result.rows || []);
      setHasEstimated(Boolean(result.hasEstimated));
      setSuccessMessage('Synced from Paychex');
      window.setTimeout(() => setSuccessMessage(''), 3000);
    } catch (err) {
      setError(err.message || 'Failed to sync from Paychex');
    } finally {
      setIsResyncing(false);
    }
  }

  async function saveSupplementField(row, field, value) {
    try {
      await apiPatch(
        '/api/certified-payroll/supplements',
        {
          workerId: row.worker_id,
          jobSiteId: selectedSite,
          weekEndingDate,
          payPeriodId: selectedPayPeriodId,
          ...row,
          [field]: value,
        },
        token
      );
      setSuppRows((all) =>
        all.map((item) =>
          item.worker_id === row.worker_id
            ? { ...item, [field]: value, isEstimated: false }
            : item
        )
      );
      setHasEstimated(false);
      setSavedWorkerId(row.worker_id);
      window.setTimeout(() => setSavedWorkerId(''), 2000);
    } catch (err) {
      setError(err.message || 'Failed to save supplement');
    }
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

          .supplement-money-cell {
            display: flex;
            align-items: center;
            gap: 2px;
          }

          .supplement-estimate-prefix {
            color: #92400e;
            font-weight: 600;
            flex-shrink: 0;
          }
        `}
      </style>

      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {a11yStatus}
      </div>

      <h1 style={{ marginBottom: '1rem' }}>Certified Payroll</h1>

      {displayError && <p style={{ color: 'crimson', marginBottom: '1rem' }}>{displayError}</p>}
      {successMessage && <p style={{ color: '#15803d', marginBottom: '1rem' }}>{successMessage}</p>}
      {isResyncing && (
        <p style={resyncStatusStyle} role="status">
          Syncing from Paychex… This may take a moment.
        </p>
      )}

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
          value={selectedPayPeriodId}
          onChange={(e) => {
            setSelectedPayPeriodId(e.target.value);
            setSelectedWeek('week2');
          }}
          style={selectStyle}
          aria-label="Pay period"
          disabled={payPeriods.length === 0}
        >
          {payPeriods.length === 0 ? (
            <option value="">No closed pay periods</option>
          ) : (
            payPeriods.map((period) => (
              <option key={period.payPeriodId} value={period.payPeriodId}>
                {period.label}
              </option>
            ))
          )}
        </select>

        <select
          value={selectedWeek}
          onChange={(e) => setSelectedWeek(e.target.value)}
          style={selectStyle}
          aria-label="Pay week"
          disabled={!selectedPeriod}
        >
          {selectedPeriod && (
            <>
              <option value="week1">{selectedPeriod.week1Label}</option>
              <option value="week2">{selectedPeriod.week2Label}</option>
            </>
          )}
        </select>

        <button
          type="button"
          style={secondaryButtonStyle}
          onClick={() => resyncFromPaychex().catch((err) => setError(err.message))}
          disabled={!selectedSite || !weekEndingDate || isResyncing || isLoadingPageData}
          aria-busy={isResyncing}
        >
          {isResyncing && <span className="spinner" aria-hidden="true" />}
          <span>{isResyncing ? 'Syncing…' : 'Re-sync from Paychex'}</span>
          {isResyncing && <span className="sr-only">Syncing from Paychex</span>}
        </button>

        <button
          type="button"
          style={primaryButtonStyle}
          onClick={() => exportPdf().catch((err) => setError(err.message))}
          disabled={!selectedSite || !weekEndingDate || isLoadingPageData}
        >
          Export WH-347 PDF
        </button>
      </div>

      <div
        aria-busy={isLoadingPageData}
        aria-label={isLoadingPageData ? 'Certified payroll data loading' : 'Certified payroll data'}
      >
        {isLoadingPageData ? (
          <>
            <DailyHourLogSkeleton />
            <Wh347SupplementSkeleton />
          </>
        ) : (
          <>
            <section style={sectionStyle}>
              <h2 style={sectionTitleStyle}>Daily Hour Log</h2>
              <div style={tableWrapStyle}>
                <table style={tableStyle}>
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
                          <td
                            style={tdStyle}
                            title={row.classification ? undefined : 'Set in Classifications'}
                          >
                            {row.classification || '—'}
                          </td>
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
              <h2 style={sectionTitleStyle}>
                WH-347 Supplement
                {hasEstimated && (
                  <span style={estimatedBadgeStyle}>Estimated — payroll not yet processed</span>
                )}
                {savedWorkerId && <span style={savedStyle}>Saved</span>}
              </h2>
              <div style={tableWrapStyle}>
                <table style={tableStyle} className="wh347-supplement-table">
                  <thead>
                    <tr>
                      <th style={{ ...thStyle, minWidth: 160 }}>Worker Name</th>
                      <th style={thStyle}>Classification</th>
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
                        <td colSpan={11} style={{ ...tdStyle, color: '#666' }}>
                          No supplement rows for this week and job site.
                        </td>
                      </tr>
                    )}
                    {suppRows.map((row) => (
                      <tr key={row.worker_id}>
                        <td style={workerNameCellStyle}>{row.worker_name}</td>
                        <td
                          style={tdStyle}
                          title={row.classification ? undefined : 'Set in Classifications'}
                        >
                          {row.classification || '—'}
                        </td>
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
                            <div
                              className={MONEY_FIELDS.has(field) ? 'supplement-money-cell' : undefined}
                            >
                              {row.isEstimated && MONEY_FIELDS.has(field) && (
                                <span className="supplement-estimate-prefix">~</span>
                              )}
                              <input
                                className="supplement-input"
                                value={row[field] ?? ''}
                                onChange={(e) => {
                                  const value = e.target.value;
                                  setSuppRows((all) =>
                                    all.map((item) =>
                                      item.worker_id === row.worker_id
                                        ? { ...item, [field]: value }
                                        : item
                                    )
                                  );
                                }}
                                onBlur={(e) => saveSupplementField(row, field, e.target.value)}
                              />
                            </div>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
