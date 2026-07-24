import { useState, useEffect, useMemo, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiGet, apiPostDownload, apiDelete } from '../api/client';

const OT_EARNINGS_MULTIPLIER = 1.5;

function parseNumericField(value) {
  if (value == null || value === '') return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatHours(value) {
  return parseNumericField(value).toFixed(1);
}

function formatMoney(value) {
  return parseNumericField(value).toFixed(2);
}

function formatMoneyDisplay(value) {
  const amount = parseNumericField(value);
  return amount.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function recomputeTotalAmount(row) {
  const hourly = parseNumericField(row['Hourly Hours']);
  const overtime = parseNumericField(row['Overtime Hours']);
  const rate = parseNumericField(row['Hourly Rate']);
  // Edited overtime column uses 1.5×; initial server rows already baked DT at 2× into Total Amount.
  return formatMoney(hourly * rate + overtime * rate * OT_EARNINGS_MULTIPLIER);
}

function getRowIssues(row) {
  const issues = [];
  const employeeId = row.worker_id ?? row['Employee ID'];
  const name = row.Name ?? row._employeeName;
  const hourlyHours = parseNumericField(row['Hourly Hours']);
  const overtimeHours = parseNumericField(row['Overtime Hours']);
  const reimbursement = parseNumericField(row['Reimbursement Amount']);

  if (!name || String(name).trim() === '') {
    issues.push('Name is blank');
  }
  if (!employeeId || String(employeeId).trim() === '') {
    issues.push('Employee ID is blank');
  }
  if (hourlyHours + overtimeHours <= 0 && reimbursement <= 0) {
    issues.push('Hours / reimbursement blank');
  }
  if (row._rateMissing && hourlyHours + overtimeHours > 0) {
    issues.push('Hourly Rate missing');
  }

  return issues;
}

const TABLE_COLUMNS = [
  { key: 'Name', label: 'Name', align: 'left' },
  { key: 'Employee ID', label: 'Employee ID', align: 'right' },
  { key: 'Total Amount', label: 'Total Amount', align: 'right' },
  { key: 'Job', label: 'Job', align: 'left' },
  { key: 'Hourly Hours', label: 'Hourly Hours', align: 'right' },
  { key: 'Hourly Rate', label: 'Hourly Rate', align: 'right' },
  { key: 'Overtime Hours', label: 'Overtime Hours', align: 'right' },
  { key: 'Reimbursement Amount', label: 'Reimbursement Amount', align: 'right' },
  { key: 'Short Pay Amount', label: 'Short Pay Amount', align: 'right' },
];

export default function PayrollExport({ payPeriodId, token, showInstructions = false }) {
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

  useEffect(() => {
    if (!payPeriodId || !token) {
      setExportRows([]);
      setPayPeriod(null);
      setClientCode('payroll');
      setWarnings([]);
      return;
    }

    async function loadPreview() {
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
    }

    loadPreview();
  }, [payPeriodId, token]);

  const rowIssues = useMemo(
    () => exportRows.map((row) => getRowIssues(row)),
    [exportRows]
  );

  const issueCount = rowIssues.filter((issues) => issues.length > 0).length;
  const hasValidationErrors = issueCount > 0;

  const totalHours = useMemo(
    () =>
      exportRows.reduce((sum, row) => {
        return (
          sum +
          parseNumericField(row['Hourly Hours']) +
          parseNumericField(row['Overtime Hours'])
        );
      }, 0),
    [exportRows]
  );

  function handleFieldChange(index, field, value) {
    setExportRows((rows) =>
      rows.map((row, i) => {
        if (i !== index) return row;

        let next = { ...row, [field]: value };
        if (field === 'Employee ID') {
          next = { ...next, worker_id: value, 'Employee ID': value };
        }
        if (
          field === 'Hourly Hours' ||
          field === 'Overtime Hours' ||
          field === 'Hourly Rate'
        ) {
          if (field === 'Hourly Hours' || field === 'Overtime Hours') {
            next[field] = value;
          }
          if (field === 'Hourly Rate') {
            next._rateMissing = false;
          }
          next['Total Amount'] = recomputeTotalAmount(next);
        }
        return next;
      })
    );
  }

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

    const { row, index } = rowPendingDelete;
    setDeleting(true);
    setError('');
    setSuccessMessage('');

    try {
      await apiDelete(`/api/payroll/${payPeriodId}/row`, token, {
        workerDbId: row._workerDbId,
        jobSiteId: row._jobSiteId ?? null,
      });
      setExportRows((rows) => rows.filter((_, i) => i !== index));
      setRowPendingDelete(null);
      setSuccessMessage('Payroll row deleted.');
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

      const downloadName = filename || `${clientCode}_ta.csv`;

      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = downloadName;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
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

      <p style={{ color: '#444', maxWidth: 720 }}>
        One row per worker per job. Hourly and overtime hours are shown as columns. Review
        amounts below, then download the CSV for SPI / Paychex payroll import.
      </p>

      {showInstructions && isAdmin && (
        <div
          style={{
            marginTop: '1rem',
            padding: '1rem',
            background: '#f7f7f7',
            borderRadius: 4,
            maxWidth: 720,
          }}
        >
          <p style={{ marginTop: 0 }}>
            <strong>Once downloaded, upload the CSV to Paychex Flex:</strong>
          </p>
          <ol style={{ marginBottom: 0, paddingLeft: '1.25rem' }}>
            <li>Log in to flex.paychex.com</li>
            <li>Go to Payroll Center</li>
            <li>Open the current active payroll → click Begin</li>
            <li>Click More Options → Import Payroll Data</li>
            <li>Select the downloaded file (e.g. 12345678_ta.csv)</li>
            <li>Review imported data, then click Review &amp; Submit → Submit Payroll</li>
          </ol>
        </div>
      )}

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
        <p style={{ marginTop: '1rem', color: '#444' }}>
          {exportRows.length} row{exportRows.length === 1 ? '' : 's'} · Total hours:{' '}
          <strong>{totalHours.toFixed(2)}</strong>
          {payPeriod?.start_date && payPeriod?.end_date
            ? ` · ${payPeriod.start_date} – ${payPeriod.end_date}`
            : ''}
        </p>
      )}

      {!loading && exportRows.length > 0 && (
        <div style={{ overflowX: 'auto', marginTop: '0.5rem' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
            <thead>
              <tr>
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
                const rowStyle = issues.length > 0 ? { background: '#fff0f0' } : {};
                const rowKey = `${row._workerDbId}-${row._jobSiteId ?? 'none'}-${index}`;

                return (
                  <tr key={rowKey} style={rowStyle}>
                    <td style={{ ...tdStyle, textAlign: 'left' }}>
                      {row.Name ?? row._employeeName}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      <input
                        type="text"
                        value={row.worker_id ?? row['Employee ID'] ?? ''}
                        onChange={(e) =>
                          handleFieldChange(index, 'Employee ID', e.target.value)
                        }
                        style={{ ...inputStyle, textAlign: 'right' }}
                      />
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      {formatMoneyDisplay(row['Total Amount'])}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'left' }}>
                      {row.Job ?? row._jobName}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={row['Hourly Hours'] ?? ''}
                        onChange={(e) =>
                          handleFieldChange(index, 'Hourly Hours', e.target.value)
                        }
                        onBlur={(e) =>
                          handleFieldChange(index, 'Hourly Hours', formatHours(e.target.value))
                        }
                        style={{ ...inputStyle, width: 72, textAlign: 'right' }}
                      />
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={row['Hourly Rate'] ?? ''}
                        onChange={(e) =>
                          handleFieldChange(index, 'Hourly Rate', e.target.value)
                        }
                        onBlur={(e) =>
                          handleFieldChange(index, 'Hourly Rate', formatMoney(e.target.value))
                        }
                        style={{ ...inputStyle, width: 80, textAlign: 'right' }}
                      />
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={row['Overtime Hours'] ?? ''}
                        onChange={(e) =>
                          handleFieldChange(index, 'Overtime Hours', e.target.value)
                        }
                        onBlur={(e) =>
                          handleFieldChange(
                            index,
                            'Overtime Hours',
                            formatHours(e.target.value)
                          )
                        }
                        style={{ ...inputStyle, width: 72, textAlign: 'right' }}
                      />
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={row['Reimbursement Amount'] ?? ''}
                        onChange={(e) =>
                          handleFieldChange(index, 'Reimbursement Amount', e.target.value)
                        }
                        onBlur={(e) =>
                          handleFieldChange(
                            index,
                            'Reimbursement Amount',
                            formatMoney(e.target.value)
                          )
                        }
                        style={{ ...inputStyle, width: 88, textAlign: 'right' }}
                      />
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={row['Short Pay Amount'] ?? ''}
                        onChange={(e) =>
                          handleFieldChange(index, 'Short Pay Amount', e.target.value)
                        }
                        onBlur={(e) =>
                          handleFieldChange(
                            index,
                            'Short Pay Amount',
                            formatMoney(e.target.value)
                          )
                        }
                        style={{ ...inputStyle, width: 88, textAlign: 'right' }}
                        title="No Short Pay data source yet — defaults to 0.00"
                      />
                    </td>
                    {isAdmin && (
                      <td style={tdStyle}>
                        <button
                          type="button"
                          onClick={() => openDeleteConfirm(row, index)}
                          aria-label={`Delete payroll row for ${row.Name ?? row._employeeName ?? 'employee'}`}
                          style={deleteButtonStyle}
                        >
                          Delete
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {isAdmin && (
        <div style={{ marginTop: '1rem' }}>
          <button
            type="button"
            onClick={handleDownload}
            disabled={loading || downloading || hasValidationErrors || exportRows.length === 0}
          >
            {downloading ? 'Downloading…' : 'Download Payroll CSV'}
          </button>
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
              Delete payroll row?
            </h3>
            <p style={{ marginBottom: '1.25rem', color: '#444' }}>
              Are you sure you want to delete this payroll row? This removes all associated
              time entries for this worker and job in this pay period (hourly and overtime).
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

const inputStyle = {
  width: '100%',
  minWidth: 64,
  padding: '0.25rem',
  boxSizing: 'border-box',
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
