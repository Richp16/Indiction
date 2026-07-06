import { useState, useEffect, useMemo } from 'react';
import { apiGet, apiPostDownload } from '../api/client';

function parseNumericField(value) {
  if (value == null || value === '') return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getRowIssues(row) {
  const issues = [];
  const workerId = row['Worker ID'];
  const payComponent = row['Pay Component'];
  const hours = parseNumericField(row.Hours);
  const amount = parseNumericField(row.Amount);

  if (!workerId || String(workerId).trim() === '') {
    issues.push('Worker ID is blank');
  }
  if (!payComponent || String(payComponent).trim() === '') {
    issues.push('Pay Component is blank');
  }
  if (hours <= 0 && amount <= 0) {
    issues.push('Hours and Amount are both blank');
  }

  return issues;
}

function updateRowField(rows, index, field, value) {
  return rows.map((row, i) => (i === index ? { ...row, [field]: value } : row));
}

export default function PayrollExport({ payPeriodId, token, showInstructions = false }) {
  const [exportRows, setExportRows] = useState([]);
  const [payPeriod, setPayPeriod] = useState(null);
  const [clientCode, setClientCode] = useState('payroll');
  const [warnings, setWarnings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');

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
    setExportRows((rows) => updateRowField(rows, index, field, value));
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

      {showInstructions && (
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
                <th style={thStyle}>Worker Name</th>
                <th style={thStyle}>Worker ID</th>
                <th style={thStyle}>Job Number</th>
                <th style={thStyle}>Job Name</th>
                <th style={thStyle}>Pay Component</th>
                <th style={thStyle}>Hours</th>
                <th style={thStyle}>Amount</th>
                <th style={thStyle}>Start Date</th>
                <th style={thStyle}>End Date</th>
              </tr>
            </thead>
            <tbody>
              {exportRows.map((row, index) => {
                const issues = rowIssues[index];
                const rowStyle = issues.length > 0 ? { background: '#fff0f0' } : {};

                return (
                  <tr key={index} style={rowStyle}>
                    <td style={tdStyle}>{row._workerName}</td>
                    <td style={tdStyle}>
                      <input
                        type="text"
                        value={row['Worker ID'] ?? ''}
                        onChange={(e) => handleFieldChange(index, 'Worker ID', e.target.value)}
                        style={inputStyle}
                      />
                    </td>
                    <td style={tdStyle}>
                      <input
                        type="text"
                        value={row['Job Number'] ?? ''}
                        onChange={(e) => handleFieldChange(index, 'Job Number', e.target.value)}
                        style={inputStyle}
                      />
                    </td>
                    <td style={tdStyle}>{row._jobName}</td>
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
                    <td style={tdStyle}>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={row.Amount ?? ''}
                        onChange={(e) => handleFieldChange(index, 'Amount', e.target.value)}
                        style={{ ...inputStyle, width: 88 }}
                      />
                    </td>
                    <td style={tdStyle}>{row['Start Date']}</td>
                    <td style={tdStyle}>{row['End Date']}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ marginTop: '1rem' }}>
        <button
          type="button"
          onClick={handleDownload}
          disabled={loading || downloading || hasValidationErrors || exportRows.length === 0}
        >
          {downloading ? 'Downloading…' : 'Download Payroll CSV'}
        </button>
      </div>
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
