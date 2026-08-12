import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiGet, apiPostDownload, apiDelete } from '../api/client';
import { downloadFile } from '../utils/downloadFile';

function parseNumericField(value) {
  if (value == null || value === '') return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildPayrollExportFilename(payPeriod) {
  const startRaw = payPeriod?.start_date || payPeriod?.startDate;
  const endRaw = payPeriod?.end_date || payPeriod?.endDate;
  if (!startRaw || !endRaw) return 'Paychex_Import.csv';
  const toDisplay = (iso) => {
    const [y, m, d] = String(iso).split('T')[0].split('-');
    return y && m && d ? `${m}.${d}.${y}` : null;
  };
  const start = toDisplay(startRaw);
  const end = toDisplay(endRaw);
  if (!start || !end) return 'Paychex_Import.csv';
  return `Paychex_Import_${start}_to_${end}.csv`;
}

function getRowIssues(row) {
  const issues = [];
  const workerId = row['Worker ID'] ?? row.worker_id;
  const component = row['Pay Component'];
  const hours = parseNumericField(row.Hours);
  const amount = parseNumericField(row.Amount);

  if (!workerId || String(workerId).trim() === '') {
    issues.push('Worker ID is blank');
  }
  if (!component || String(component).trim() === '') {
    issues.push('Pay Component is blank');
  }
  if ((component === 'Hourly' || component === 'Overtime') && hours <= 0) {
    issues.push('Hours blank');
  }
  if (component === 'Reimbursement' && amount <= 0) {
    issues.push('Amount blank');
  }
  if (component === 'Hourly' && row._rateMissing) {
    issues.push('Rate missing');
  }
  if (component === 'Overtime' && String(row.Rate ?? '').trim() !== '') {
    issues.push('Overtime Rate must be blank');
  }

  return issues;
}

/** Match Paychex_Import.csv column order exactly. */
const TABLE_COLUMNS = [
  { key: 'Company ID', label: 'Company ID', align: 'left' },
  { key: 'Worker ID', label: 'Worker ID', align: 'right' },
  { key: 'Org', label: 'Org', align: 'left' },
  { key: 'Job Number', label: 'Job Number', align: 'left' },
  { key: 'Job Name', label: 'Job Name', align: 'left' },
  { key: 'Pay Component', label: 'Pay Component', align: 'left' },
  { key: 'Rate', label: 'Rate', align: 'right' },
  { key: 'Rate #', label: 'Rate #', align: 'right' },
  { key: 'Hours', label: 'Hours', align: 'right' },
  { key: 'Units', label: 'Units', align: 'right' },
  { key: 'Line Date', label: 'Line Date', align: 'left' },
  { key: 'Amount', label: 'Amount', align: 'right' },
  { key: 'Check Seq Number', label: 'Check Seq Number', align: 'right' },
  { key: 'Override State', label: 'Override State', align: 'left' },
  { key: 'Override Local', label: 'Override Local', align: 'left' },
  {
    key: 'Override Local Jurisdiction',
    label: 'Override Local Jurisdiction',
    align: 'left',
  },
  { key: 'Labor Override', label: 'Labor Override', align: 'left' },
];

function cellDisplay(row, key) {
  const value = row[key];
  if (value == null || value === '') return '';
  return String(value);
}

export default function PayrollExport({ payPeriodId, token }) {
  const { isAdmin } = useAuth();
  const [exportRows, setExportRows] = useState([]);
  const [payPeriod, setPayPeriod] = useState(null);
  const [clientCode, setClientCode] = useState('payroll');
  const [warnings, setWarnings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [rowPendingDelete, setRowPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const cancelButtonRef = useRef(null);

  const loadPreview = useCallback(async () => {
    if (!payPeriodId || !token) {
      setExportRows([]);
      setPayPeriod(null);
      setClientCode('payroll');
      setWarnings([]);
      return;
    }

    setLoading(true);
    setError('');
    try {
      const data = await apiGet(`/api/payroll/${payPeriodId}/preview`, token);
      setExportRows(data.rows || []);
      setPayPeriod(data.payPeriod || null);
      setClientCode(data.clientCode || 'payroll');
      setWarnings(data.warnings || []);
    } catch (err) {
      setError(err.message || 'Failed to load payroll export preview');
      setExportRows([]);
      setWarnings([]);
    } finally {
      setLoading(false);
    }
  }, [payPeriodId, token]);

  useEffect(() => {
    loadPreview();
  }, [loadPreview]);

  const rowIssues = useMemo(
    () => exportRows.map((row) => getRowIssues(row)),
    [exportRows]
  );

  const issueCount = rowIssues.filter((issues) => issues.length > 0).length;
  const hasValidationErrors = issueCount > 0;

  const totalHours = useMemo(
    () =>
      exportRows.reduce((sum, row) => {
        const component = row['Pay Component'];
        if (component === 'Hourly' || component === 'Overtime') {
          return sum + parseNumericField(row.Hours);
        }
        return sum;
      }, 0),
    [exportRows]
  );

  function openDeleteConfirm(row, index) {
    setError('');
    setSuccessMessage('');
    setRowPendingDelete({ row, index });
  }

  function closeDeleteConfirm() {
    if (deleting) return;
    setRowPendingDelete(null);
  }

  useEffect(() => {
    if (rowPendingDelete && cancelButtonRef.current) {
      cancelButtonRef.current.focus();
    }
  }, [rowPendingDelete]);

  useEffect(() => {
    if (!rowPendingDelete) return undefined;

    function onKeyDown(event) {
      if (event.key === 'Escape' && !deleting) {
        setRowPendingDelete(null);
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [rowPendingDelete, deleting]);

  async function confirmDeleteRow() {
    if (!rowPendingDelete || !payPeriodId) return;

    const { row } = rowPendingDelete;
    setDeleting(true);
    setError('');
    setSuccessMessage('');

    try {
      await apiDelete(`/api/payroll/${payPeriodId}/row`, token, {
        workerDbId: row._workerDbId,
      });
      const workerKey = String(row._workerDbId);
      setExportRows((rows) =>
        rows.filter((r) => String(r._workerDbId) !== workerKey)
      );
      setRowPendingDelete(null);
      setSuccessMessage('Worker payroll rows deleted for this pay period.');
    } catch (err) {
      setError(err.message || 'Unable to delete row. Please try again or contact support.');
    } finally {
      setDeleting(false);
    }
  }

  async function handleDownload() {
    if (!payPeriodId || hasValidationErrors) return;

    setDownloading(true);
    setError('');
    try {
      const { blob, filename } = await apiPostDownload(
        `/api/payroll/${payPeriodId}/download`,
        { rows: exportRows },
        token
      );

      const downloadName = filename || buildPayrollExportFilename(payPeriod);
      const result = await downloadFile(blob, downloadName, 'text/csv');
      if (!result.success && !result.cancelled) {
        setError('Download failed');
      }
    } catch (err) {
      setError(err.message || 'Download failed');
    } finally {
      setDownloading(false);
    }
  }

  if (!payPeriodId) {
    return null;
  }

  return (
    <section style={{ marginTop: '2rem' }}>
      <h2>Payroll Export</h2>

      {loading && <p>Loading payroll export…</p>}
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      {successMessage && <p style={{ color: '#15803d' }}>{successMessage}</p>}

      {warnings.length > 0 && (
        <ul style={{ color: '#964219' }}>
          {warnings.map((warning, index) => (
            <li key={index}>{warning.message}</li>
          ))}
        </ul>
      )}

      {!loading && issueCount > 0 && (
        <p style={{ color: 'crimson' }}>
          ⚠ {issueCount} row{issueCount === 1 ? '' : 's'} have issues. Fix before downloading.
        </p>
      )}

      {!loading && exportRows.length === 0 && !error && (
        <p>No exportable entries for this pay period.</p>
      )}

      {!loading && exportRows.length > 0 && (
        <div
          style={{
            marginTop: '1rem',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '0.75rem',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <p style={{ margin: 0, color: '#444' }}>
            {exportRows.length} row{exportRows.length === 1 ? '' : 's'} · Total hours:{' '}
            <strong>{totalHours.toFixed(2)}</strong>
            {payPeriod?.start_date && payPeriod?.end_date
              ? ` · ${payPeriod.start_date} – ${payPeriod.end_date}`
              : ''}
          </p>
          {isAdmin && (
            <button
              type="button"
              onClick={handleDownload}
              disabled={loading || downloading || hasValidationErrors}
            >
              {downloading ? 'Downloading…' : 'Download Payroll CSV'}
            </button>
          )}
        </div>
      )}

      {!loading && exportRows.length > 0 && (
        <div style={{ overflowX: 'auto', marginTop: '0.5rem' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr>
                <th style={{ ...thStyle, textAlign: 'left' }}>Worker</th>
                {TABLE_COLUMNS.map((col) => (
                  <th
                    key={col.key}
                    style={{
                      ...thStyle,
                      textAlign: col.align,
                    }}
                  >
                    {col.label}
                  </th>
                ))}
                {isAdmin && <th style={thStyle}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {exportRows.map((row, index) => {
                const issues = rowIssues[index];
                const prevSeq =
                  index > 0 ? exportRows[index - 1]['Check Seq Number'] : null;
                const seq = row['Check Seq Number'];
                const isNewWorkerGroup = seq !== prevSeq;
                const rowStyle = {
                  ...(issues.length > 0 ? { background: '#fff0f0' } : {}),
                  ...(isNewWorkerGroup && index > 0
                    ? { borderTop: '2px solid #94a3b8' }
                    : {}),
                };
                const rowKey = `${row._workerDbId ?? row['Worker ID']}-${row['Pay Component']}-${row.Rate ?? ''}-${index}`;

                return (
                  <tr key={rowKey} style={rowStyle}>
                    <td style={{ ...tdStyle, textAlign: 'left', whiteSpace: 'nowrap' }}>
                      {row._employeeName || '—'}
                    </td>
                    {TABLE_COLUMNS.map((col) => (
                      <td
                        key={col.key}
                        style={{
                          ...tdStyle,
                          textAlign: col.align,
                          fontWeight:
                            col.key === 'Check Seq Number' ? 600 : undefined,
                        }}
                      >
                        {cellDisplay(row, col.key)}
                      </td>
                    ))}
                    {isAdmin && (
                      <td style={tdStyle}>
                        {isNewWorkerGroup ? (
                          <button
                            type="button"
                            onClick={() => openDeleteConfirm(row, index)}
                            aria-label={`Delete payroll rows for ${row._employeeName ?? row['Worker ID'] ?? 'employee'}`}
                            style={deleteButtonStyle}
                          >
                            Delete
                          </button>
                        ) : null}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {rowPendingDelete && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-payroll-row-title"
          style={modalOverlayStyle}
          onClick={closeDeleteConfirm}
        >
          <div style={modalCardStyle} onClick={(e) => e.stopPropagation()}>
            <h3 id="delete-payroll-row-title" style={{ marginTop: 0 }}>
              Delete worker payroll rows?
            </h3>
            <p style={{ marginBottom: '1.25rem', color: '#444' }}>
              This removes all associated time entries for{' '}
              <strong>
                {rowPendingDelete.row?._employeeName ||
                  rowPendingDelete.row?.['Worker ID'] ||
                  'this worker'}
              </strong>{' '}
              in this pay period (all Hourly, Overtime, and related entries). Check Seq{' '}
              {rowPendingDelete.row?.['Check Seq Number'] ?? '—'}.
            </p>
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button
                type="button"
                ref={cancelButtonRef}
                onClick={closeDeleteConfirm}
                disabled={deleting}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDeleteRow}
                disabled={deleting}
                style={deleteConfirmButtonStyle}
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

const thStyle = {
  textAlign: 'left',
  borderBottom: '1px solid #ccc',
  padding: '0.5rem',
  whiteSpace: 'nowrap',
  fontWeight: 600,
  color: '#1e293b',
};

const tdStyle = {
  borderBottom: '1px solid #e5e7eb',
  padding: '0.35rem 0.5rem',
  verticalAlign: 'middle',
};

const deleteButtonStyle = {
  background: 'none',
  border: 'none',
  color: '#b91c1c',
  cursor: 'pointer',
  padding: 0,
  fontSize: '0.875rem',
  textDecoration: 'underline',
};

const modalOverlayStyle = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0, 0, 0, 0.45)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '1rem',
  zIndex: 1000,
};

const modalCardStyle = {
  background: '#fff',
  borderRadius: 6,
  padding: '1.25rem',
  maxWidth: 480,
  width: '100%',
  boxShadow: '0 10px 30px rgba(0, 0, 0, 0.2)',
};

const deleteConfirmButtonStyle = {
  background: '#b91c1c',
  color: '#fff',
  border: 'none',
  borderRadius: 4,
  padding: '0.4rem 0.9rem',
  cursor: 'pointer',
};
