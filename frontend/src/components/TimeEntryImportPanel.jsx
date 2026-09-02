import { useRef, useState } from 'react';
import { apiGetDownload, apiPost, apiPostForm } from '../api/client';
import { useEditLock } from '../context/EditLockContext';

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function TimeEntryImportPanel({ token, onCommitted }) {
  const fileInputRef = useRef(null);
  const { isLockHolder, acquireLock } = useEditLock();
  const [preview, setPreview] = useState(null);
  const [mode, setMode] = useState('merge');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [createWorkers, setCreateWorkers] = useState({});

  async function downloadTemplate() {
    const { blob, filename } = await apiGetDownload('/api/entries/import/template', token);
    downloadBlob(blob, filename);
  }

  async function handleFile(file) {
    setError('');
    setMessage('');
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const result = await apiPostForm('/api/entries/import/preview', formData, token);
      setPreview(result);
      const defaults = {};
      for (const worker of result.unmatchedWorkers || []) {
        defaults[worker.rowNumber] = true;
      }
      setCreateWorkers(defaults);
    } catch (err) {
      setError(err.message);
      setPreview(null);
    } finally {
      setLoading(false);
    }
  }

  async function commitImport() {
    if (!preview?.importId) return;
    setError('');
    setMessage('');
    setLoading(true);
    try {
      if (!isLockHolder) {
        await acquireLock();
      }
      const workersToCreate = (preview.unmatchedWorkers || [])
        .filter((worker) => createWorkers[worker.rowNumber])
        .map((worker) => ({
          rowNumber: worker.rowNumber,
          employeeCode: worker.employeeCode,
          firstName: worker.firstName,
          lastName: worker.lastName,
        }));
      const result = await apiPost(
        '/api/entries/import/commit',
        {
          importId: preview.importId,
          mode,
          createWorkers: workersToCreate,
        },
        token
      );
      setMessage(`Imported ${result.created} rows (${result.skipped} skipped).`);
      setPreview(null);
      onCommitted?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '1rem', marginBottom: '1rem' }}>
      <h2 style={{ marginTop: 0, fontSize: '1.1rem' }}>Import spreadsheet</h2>
      <p style={{ marginTop: 0 }}>
        Upload daily time entries from Excel (.xlsx) or CSV. Non-Paychex mode only.
      </p>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
        <button type="button" onClick={downloadTemplate}>
          Download template
        </button>
        <button type="button" onClick={() => fileInputRef.current?.click()} disabled={loading}>
          Choose file
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            e.target.value = '';
          }}
        />
      </div>

      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      {message && <p style={{ color: '#15803d' }}>{message}</p>}

      {preview && (
        <div>
          <p>
            {preview.matchedCount} matched rows, {preview.errorCount} errors,{' '}
            {preview.unmatchedWorkerCount} unmatched workers, {preview.unmatchedSiteCount} unmatched sites.
          </p>
          <label style={{ display: 'inline-flex', gap: 8, marginBottom: 8 }}>
            <span>Import mode</span>
            <select value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="merge">Merge</option>
              <option value="replace">Replace rows for same worker/date/site/code</option>
            </select>
          </label>

          {(preview.unmatchedWorkers || []).length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <strong>Unmatched workers</strong>
              <ul>
                {preview.unmatchedWorkers.map((worker) => (
                  <li key={worker.rowNumber}>
                    <label>
                      <input
                        type="checkbox"
                        checked={Boolean(createWorkers[worker.rowNumber])}
                        onChange={(e) =>
                          setCreateWorkers((current) => ({
                            ...current,
                            [worker.rowNumber]: e.target.checked,
                          }))
                        }
                      />
                      Row {worker.rowNumber}: {worker.firstName} {worker.lastName}
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <button type="button" onClick={commitImport} disabled={loading || !isLockHolder}>
            Commit import
          </button>
        </div>
      )}
    </div>
  );
}
