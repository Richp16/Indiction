import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiGet, apiPatch, apiPost, apiPostDownload } from '../api/client';
import { downloadFile } from '../utils/downloadFile';
import PaychexSyncButton from '../components/PaychexSyncButton';
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

const warningBannerStyle = {
  padding: '0.65rem 0.85rem',
  marginBottom: '0.5rem',
  borderRadius: 6,
  background: '#fffbeb',
  border: '1px solid #fcd34d',
  color: '#92400e',
  fontSize: 13,
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
    selectedPeriodPaychexId,
    weekEndingDate,
    hoursRows,
    setHoursRows,
    suppRows,
    setSuppRows,
    setHasEstimated,
    needsManualWithholding,
    setNeedsManualWithholding,
    reconciliationWarnings,
    setReconciliationWarnings,
    payrollDebug,
    setPayrollDebug,
    checksError,
    checksErrorDebug,
    isLoadingPageData,
    loadError,
  } = useCertifiedPayrollData(token);

  const [isResyncing, setIsResyncing] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [savedWorkerId, setSavedWorkerId] = useState('');
  const [a11yStatus, setA11yStatus] = useState('');
  const [contractorRole, setContractorRole] = useState('prime'); // 'prime' | 'sub'
  const [classifications, setClassifications] = useState([]);
  const [classificationSavingId, setClassificationSavingId] = useState('');
  const [classificationErrors, setClassificationErrors] = useState({});

  useEffect(() => {
    if (!token) return undefined;
    let cancelled = false;
    apiGet('/api/labor-classifications', token)
      .then((rows) => {
        if (!cancelled) setClassifications(rows || []);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Failed to load labor classifications');
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

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
        const classification = row.labor_classification || '';
        map.set(row.id, {
          workerId: row.id,
          workerName: `${row.last_name || ''}, ${row.first_name || ''}`,
          classification,
          needsClassification: Boolean(
            row.needs_classification ?? row.needsClassification ?? !classification
          ),
          workerType: normalizeWorkerType(row.worker_type),
          rate: Number(row.pay_rate) || 0,
          entries: [],
        });
      }
      map.get(row.id).entries.push(row);
    }
    return [...map.values()];
  }, [hoursRows]);

  const workersMissingClassification = useMemo(
    () => grouped.filter((row) => row.needsClassification),
    [grouped]
  );
  const hasMissingClassifications = workersMissingClassification.length > 0;

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

  async function assignWorkerClassification(workerId, laborClassificationId) {
    if (!laborClassificationId) return;

    const selected = classifications.find(
      (c) => String(c.id) === String(laborClassificationId)
    );
    const name = selected?.name || '';

    setClassificationErrors((prev) => {
      const next = { ...prev };
      delete next[workerId];
      return next;
    });
    setClassificationSavingId(workerId);
    setError('');

    // Optimistic update — collapse dropdown to plain text like other rows.
    setHoursRows((rows) =>
      rows.map((row) =>
        row.id === workerId
          ? {
              ...row,
              labor_classification: name,
              needs_classification: false,
              needsClassification: false,
            }
          : row
      )
    );
    setSuppRows((rows) =>
      rows.map((row) =>
        row.worker_id === workerId
          ? { ...row, classification: name, needsClassification: false }
          : row
      )
    );

    try {
      await apiPatch(
        `/api/workers/${workerId}/labor-classification`,
        { laborClassificationId: Number(laborClassificationId) },
        token
      );
    } catch (err) {
      setHoursRows((rows) =>
        rows.map((row) =>
          row.id === workerId
            ? {
                ...row,
                labor_classification: '',
                needs_classification: true,
                needsClassification: true,
              }
            : row
        )
      );
      setSuppRows((rows) =>
        rows.map((row) =>
          row.worker_id === workerId
            ? { ...row, classification: '', needsClassification: true }
            : row
        )
      );
      setClassificationErrors((prev) => ({
        ...prev,
        [workerId]: err.message || 'Failed to save classification',
      }));
    } finally {
      setClassificationSavingId('');
    }
  }

  function renderClassificationCell(row) {
    if (!row.needsClassification) {
      return row.classification || '—';
    }

    return (
      <div>
        <select
          value=""
          onChange={(e) => assignWorkerClassification(row.workerId, e.target.value)}
          disabled={classificationSavingId === row.workerId}
          style={{ ...selectStyle, minWidth: 160 }}
          aria-label={`Assign classification for ${row.workerName}`}
          data-testid={`classification-select-${row.workerId}`}
        >
          <option value="">Select classification…</option>
          {classifications.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {classificationErrors[row.workerId] && (
          <div style={{ color: 'crimson', fontSize: 12, marginTop: 4 }}>
            {classificationErrors[row.workerId]}
          </div>
        )}
      </div>
    );
  }

  async function exportPdf() {
    if (hasMissingClassifications) {
      throw new Error(
        `Assign a labor classification before generating WH-347 for: ${workersMissingClassification
          .map((w) => w.workerName)
          .join('; ')}`
      );
    }

    const site = sites.find((s) => s.id === selectedSite);
    // QA: append ?flatten=false to the Certified Payroll URL for an editable PDF.
    const flattenParam = new URLSearchParams(window.location.search).get('flatten');
    const flatten = flattenParam == null ? true : flattenParam !== 'false';

    const { blob, filename } = await apiPostDownload(
      '/api/certified-payroll/export',
      {
        jobSiteId: selectedSite,
        weekEndingDate,
        payPeriodId: selectedPayPeriodId,
        flatten,
        isPrime: contractorRole === 'prime',
      },
      token
    );
    const downloadName = filename || `WH347-${site?.job_code || 'site'}-${weekEndingDate}.pdf`;
    const result = await downloadFile(blob, downloadName, 'application/pdf');
    if (!result.success && !result.cancelled) {
      throw new Error('Failed to save PDF. Please try again.');
    }
  }

  async function resyncFromPaychex() {
    if (!selectedSite || !selectedPayPeriodId || !weekEndingDate || !selectedPeriod) {
      throw new Error('Select a job site and pay period before syncing.');
    }
    setError('');
    setSuccessMessage('');
    setIsResyncing(true);
    try {
      const result = await apiPost(
        '/api/certified-payroll/resync',
        {
          jobSiteId: selectedSite,
          payPeriodId: selectedPayPeriodId,
          paychexPayPeriodId: selectedPeriodPaychexId || undefined,
          weekEndingDate,
          week1End: selectedPeriod.week1End,
          week2End: selectedPeriod.week2End,
          selectedWeek,
        },
        token
      );
      setSuppRows(result.rows || []);
      setHasEstimated(Boolean(result.hasEstimated));
      setNeedsManualWithholding(Boolean(result.needsManualWithholding));
      setReconciliationWarnings(result.warnings || null);
      setPayrollDebug(result.debug || null);
      setSuccessMessage('Synced from Paychex');
      window.setTimeout(() => setSuccessMessage(''), 3000);
      return 'Synced from Paychex';
    } catch (err) {
      setError(err.message || 'Failed to sync from Paychex');
      throw err;
    } finally {
      setIsResyncing(false);
    }
  }

  function recalculateNetPay(row) {
    const withholdingRaw = row.deduction_withholding;
    if (withholdingRaw == null || String(withholdingRaw).trim() === '') {
      return '';
    }
    const gross = Number(row.gross_earned_all_work) || 0;
    const fica = Number(row.deduction_fica) || 0;
    const withholding = Number(withholdingRaw) || 0;
    const other = Number(row.deduction_other) || 0;
    return (Math.round((gross - fica - withholding - other) * 100) / 100).toFixed(2);
  }

  async function saveSupplementField(row, field, value) {
    const nextRow = { ...row, [field]: value };
    if (field === 'deduction_withholding' || field === 'deduction_other') {
      nextRow.net_pay = recalculateNetPay(nextRow);
    }

    try {
      await apiPatch(
        '/api/certified-payroll/supplements',
        {
          workerId: row.worker_id,
          jobSiteId: selectedSite,
          weekEndingDate,
          payPeriodId: selectedPayPeriodId,
          ...nextRow,
        },
        token
      );
      setSuppRows((all) => {
        const updated = all.map((item) =>
          item.worker_id === row.worker_id
            ? {
                ...item,
                ...nextRow,
                isEstimated: false,
                needsManualWithholding:
                  String(nextRow.deduction_withholding ?? '').trim() === '',
              }
            : item
        );
        setNeedsManualWithholding(
          updated.some(
            (item) =>
              item.needsManualWithholding ||
              String(item.deduction_withholding ?? '').trim() === ''
          )
        );
        return updated;
      });
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
            <option value="">No Paychex pay periods (sync in Settings)</option>
          ) : (
            payPeriods.map((period) => {
              const baseLabel = period.displayLabel || period.label || period.description || period.payPeriodId;
              const alreadyHasChecks = /\(\d+\s+checks\)/i.test(String(baseLabel));
              const countSuffix =
                !alreadyHasChecks && period.checkCount != null && Number.isFinite(Number(period.checkCount))
                  ? ` (${Number(period.checkCount)} checks)`
                  : '';
              return (
                <option key={period.payPeriodId} value={period.payPeriodId}>
                  {baseLabel}
                  {countSuffix}
                </option>
              );
            })
          )}
        </select>

        {selectedPeriod && (
          <span
            style={{
              fontSize: 12,
              color: '#64748b',
              alignSelf: 'center',
              maxWidth: 420,
            }}
            data-testid="paychex-period-link"
          >
            {`Selected Paychex pay period ID: ${selectedPeriodPaychexId || selectedPeriod.payPeriodId}`}
          </span>
        )}

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

        <PaychexSyncButton
          label="Re-sync from Paychex"
          token={token}
          onSync={resyncFromPaychex}
          disabled={!selectedSite || !weekEndingDate || isLoadingPageData}
          className=""
          style={secondaryButtonStyle}
        />

        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          <span style={{ color: '#64748b', whiteSpace: 'nowrap' }}>Contractor role</span>
          <select
            value={contractorRole}
            onChange={(e) => setContractorRole(e.target.value)}
            style={selectStyle}
            aria-label="Prime or Subcontractor for WH-347"
            data-testid="contractor-role-select"
          >
            <option value="prime">Prime Contractor</option>
            <option value="sub">Subcontractor</option>
          </select>
        </label>

        <button
          type="button"
          style={primaryButtonStyle}
          onClick={() => exportPdf().catch((err) => setError(err.message))}
          disabled={
            !selectedSite ||
            !weekEndingDate ||
            isLoadingPageData ||
            hasMissingClassifications
          }
          title={
            hasMissingClassifications
              ? 'Assign a classification to every worker before exporting WH-347'
              : undefined
          }
          data-testid="export-wh347-button"
        >
          Export WH-347 PDF
        </button>
      </div>

      {hasMissingClassifications && !isLoadingPageData && (
        <div
          className="alert alert-warning"
          style={warningBannerStyle}
          data-testid="missing-classification-banner"
        >
          Assign a labor classification for{' '}
          {workersMissingClassification.map((w) => w.workerName).join('; ')} before
          generating WH-347.
        </div>
      )}

      {(checksError) && (
        <div
          style={{
            marginBottom: '1rem',
            padding: '0.75rem 1rem',
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: 6,
            fontSize: 13,
          }}
          data-testid="checks-preview"
        >
          <p style={{ margin: 0, color: 'crimson' }}>{checksError}</p>
          {import.meta.env.DEV && checksErrorDebug && (
            <p
              style={{ margin: '0.35rem 0 0', color: '#64748b', fontSize: 12 }}
              data-testid="checks-error-debug"
            >
              debug: companyId={checksErrorDebug.companyId ?? '—'} · payPeriodId=
              {checksErrorDebug.payPeriodId ?? '—'} · HTTP {checksErrorDebug.status ?? '—'} ·
              code={checksErrorDebug.errorCode ?? '—'}
            </p>
          )}
        </div>
      )}

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
            {reconciliationWarnings && (
              <div style={{ marginBottom: '1rem' }} data-testid="reconciliation-warnings">
                {reconciliationWarnings.checksUnavailable && (
                  <div className="alert alert-warning" style={warningBannerStyle}>
                    {reconciliationWarnings.checksUnavailable.message ||
                      'Paychex checks are not available for this pay period.'}
                    {reconciliationWarnings.checksUnavailable.periodStatus
                      ? ` (status: ${reconciliationWarnings.checksUnavailable.periodStatus})`
                      : ''}
                  </div>
                )}
                {(reconciliationWarnings.workersWithHoursButNoPaychexCheck || []).length > 0 && (
                  <div className="alert alert-warning" style={warningBannerStyle}>
                    {reconciliationWarnings.workersWithHoursButNoPaychexCheck.length} worker(s)
                    with hours but no Paychex check for this pay period.
                  </div>
                )}
                {(reconciliationWarnings.paychexChecksWithoutCertifiedPayrollRows || []).length >
                  0 && (
                  <div className="alert alert-warning" style={warningBannerStyle}>
                    {reconciliationWarnings.paychexChecksWithoutCertifiedPayrollRows.length}{' '}
                    Paychex check(s) with no hours on this job site / week.
                  </div>
                )}
                {(reconciliationWarnings.workersWithMultipleChecksInSamePayPeriod || [])
                  .length > 0 && (
                  <div className="alert alert-warning" style={warningBannerStyle}>
                    {reconciliationWarnings.workersWithMultipleChecksInSamePayPeriod.length}{' '}
                    worker(s) have multiple checks in this pay period (highest gross used).
                  </div>
                )}
                {(reconciliationWarnings.taxDataUnavailableWorkers || []).length > 0 && (
                  <div className="alert alert-warning" style={warningBannerStyle}>
                    {(reconciliationWarnings.taxDataUnavailableWorkers || [])
                      .map((w) => w.workerName || w.paychexWorkerId || w.workerId)
                      .join(', ')}
                    : ⚠ Tax data unavailable — verify manually
                  </div>
                )}
              </div>
            )}

            <section style={sectionStyle}>
              <h2 style={sectionTitleStyle}>Daily Hour Log</h2>
              <p style={{ marginTop: 0, color: '#64748b', fontSize: 13 }}>
                Hours from internal time entries (not Paychex).
                {hoursRows.length === 0 && selectedPeriod
                  ? ' No time entries found for this job site in this Paychex pay period / week.'
                  : ''}
              </p>
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
                            title={
                              row.needsClassification
                                ? 'Assign a classification to include this worker on WH-347'
                                : undefined
                            }
                          >
                            {renderClassificationCell(row)}
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
                {needsManualWithholding && (
                  <span style={estimatedBadgeStyle}>Enter federal withholding manually</span>
                )}
                {suppRows.some((r) => r.taxDataUnavailable) && (
                  <span style={estimatedBadgeStyle}>⚠ Tax data unavailable — verify manually</span>
                )}
                {savedWorkerId && <span style={savedStyle}>Saved</span>}
              </h2>
              <p style={{ marginTop: 0, color: '#64748b', fontSize: 13 }}>
                Money fields prefer Paychex checks for the linked pay period when available.
              </p>
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
                        <td style={workerNameCellStyle}>
                          {row.worker_name}
                          {row.taxDataUnavailable ? (
                            <div style={{ color: '#92400e', fontSize: 11, marginTop: 2 }}>
                              ⚠ Tax data unavailable — verify manually
                            </div>
                          ) : null}
                        </td>
                        <td
                          style={tdStyle}
                          title={
                            row.needsClassification
                              ? 'Assign a classification in the Daily Hour Log table'
                              : undefined
                          }
                        >
                          {row.needsClassification ? (
                            <span style={{ color: '#92400e' }}>Needs classification</span>
                          ) : (
                            row.classification || '—'
                          )}
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
                              <input
                                className="supplement-input"
                                value={row[field] ?? ''}
                                placeholder={
                                  field === 'deduction_withholding' ||
                                  field === 'deduction_fica' ||
                                  field === 'deduction_other' ||
                                  field === 'net_pay'
                                    ? row.taxDataUnavailable
                                      ? 'Unavailable'
                                      : '—'
                                    : undefined
                                }
                                onChange={(e) => {
                                  const value = e.target.value;
                                  setSuppRows((all) =>
                                    all.map((item) => {
                                      if (item.worker_id !== row.worker_id) return item;
                                      const updated = { ...item, [field]: value };
                                      if (
                                        field === 'deduction_withholding' ||
                                        field === 'deduction_other'
                                      ) {
                                        updated.net_pay = recalculateNetPay(updated);
                                      }
                                      return updated;
                                    })
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

            {import.meta.env.DEV && payrollDebug && (
              <details style={{ marginTop: '1rem', marginBottom: '1rem' }} data-testid="payroll-debug">
                <summary style={{ cursor: 'pointer', color: '#64748b' }}>
                  Paychex payroll debug
                </summary>
                <pre
                  style={{
                    marginTop: '0.5rem',
                    background: '#0f172a',
                    color: '#e2e8f0',
                    padding: '0.75rem',
                    borderRadius: 6,
                    overflow: 'auto',
                    maxHeight: 320,
                    fontSize: 12,
                  }}
                >
                  {JSON.stringify(
                    {
                      localPayPeriodId: payrollDebug.localPayPeriodId,
                      paychexPayPeriodId: payrollDebug.paychexPayPeriodId,
                      hoursSource: payrollDebug.hoursSource,
                      moneySource: payrollDebug.moneySource,
                      checksFetched: payrollDebug.checksFetched,
                      workers: payrollDebug.workers,
                    },
                    null,
                    2
                  )}
                </pre>
              </details>
            )}
          </>
        )}
      </div>
    </div>
  );
}
