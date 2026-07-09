import { useState, useEffect, useMemo, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiGet, apiPostDownload, apiDelete } from '../api/client';

function parseNumericField(value) {
  if (value == null || value === '') return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getRowIssues(row) {
  const issues = [];
  const companyId = row['Company ID'];
  const workerId = row.worker_id ?? row['Worker ID'];
  const payComponent = row['Pay Component'];
  const hours = parseNumericField(row.Hours);

  if (!companyId || String(companyId).trim() === '') {
    issues.push('Company ID is blank');
  }
  if (!workerId || String(workerId).trim() === '') {
    issues.push('Worker ID is blank');
  }
  if (!payComponent || String(payComponent).trim() === '') {
    issues.push('Pay Component is blank');
  }
  if (hours <= 0) {
    issues.push('Hours is blank');
  }

  return issues;
}

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

  function handleFieldChange(index, field, value) {
    setExportRows((rows) =>
      rows.map((row, i) => {
        if (i !== index) return row;
        if (field === 'worker_id') {
          return { ...row, worker_id: value, 'Worker ID': value };
        }
        return { ...row, [field]: value };
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
        payComponent: row._payCode,
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
        Review pay entries below. Pay Component names must exactly match your Paychex Flex Pay
        Items (Settings → Pay Items → Payroll). Job Numbers are pulled from your synced job sites.
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
        <div style={{ overflowX: 'auto', marginTop: '1rem' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
            <thead>
              <tr>
                <th style={thStyle}>Company ID</th>
                <th style={thStyle}>Worker ID</th>
                <th style={thStyle}>Employee Name</th>
                <th style={thStyle}>Job Number</th>
                <th style={thStyle}>Job Name</th>
                <th style={thStyle}>Pay Component</th>
                <th style={thStyle}>Hours</th>
                {isAdmin && <th style={thStyle}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {exportRows.map((row, index) => {
                const issues = rowIssues[index];
                const rowStyle = issues.length > 0 ? { background: '#fff0f0' } : {};

                return (
                  <tr key={index} style={rowStyle}>
                    <td style={tdStyle}>{row['Company ID'] ?? clientCode}</td>
                    <td style={tdStyle}>
                      <input
                        type="text"
                        value={row.worker_id ?? row['Worker ID'] ?? ''}
                        onChange={(e) => handleFieldChange(index, 'worker_id', e.target.value)}
                        style={inputStyle}
                      />
                    </td>
                    <td style={tdStyle}>{row['Employee Name'] ?? row._employeeName}</td>
                    <td style={tdStyle}>
                      <input
                        type="text"
                        value={row['Job Number'] ?? ''}
                        onChange={(e) => handleFieldChange(index, 'Job Number', e.target.value)}
                        style={inputStyle}
                      />
                    </td>
                    <td style={tdStyle}>{row['Job Name'] ?? row._jobName}</td>
                    <td style={tdStyle}>
                      <input
                        type="text"
                        value={row['Pay Component'] ?? ''}
                        onChange={(e) =>
                          handleFieldChange(index, 'Pay Component', e.target.value)
                        }
                        style={inputStyle}
                      />
                    </td>
                    <td style={tdStyle}>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={row.Hours ?? ''}
                        onChange={(e) => handleFieldChange(index, 'Hours', e.target.value)}
                        style={{ ...inputStyle, width: 72 }}
                      />
                    </td>
                    {isAdmin && (
                      <td style={tdStyle}>
                        <button
                          type="button"
                          onClick={() => openDeleteConfirm(row, index)}
                          aria-label={`Delete payroll row for ${row['Employee Name'] ?? row._employeeName ?? 'employee'}`}
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
              Are you sure you want to delete this payroll row? This will remove the associated
              time entries for this worker/site/pay component for this pay period.
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
};

const tdStyle = {
  borderBottom: '1px solid #eee',
  padding: '0.35rem',
  verticalAlign: 'top',
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
  padding: '0.5rem 0.9rem',
  cursor: 'pointer',
};
