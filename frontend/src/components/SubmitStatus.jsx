export default function SubmitStatus({ results }) {
  if (!results || results.length === 0) {
    return (
      <p className="form-hint" style={{ padding: 'var(--space-4)' }}>
        No submission results yet
      </p>
    );
  }

  const successCount = results.filter((r) => r.status === 'SUCCESS').length;

  return (
    <div>
      <p className="form-label" style={{ marginBottom: 'var(--space-4)' }}>
        {successCount} of {results.length} workers submitted successfully
      </p>
      <div className="table-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              <th>Worker</th>
              <th>Status</th>
              <th>Check ID</th>
              <th>Error</th>
            </tr>
          </thead>
          <tbody>
            {results.map((result) => (
              <tr key={result.workerDbId || result.workerId || result.workerName}>
                <td>{result.workerName}</td>
                <td>
                  {result.status === 'SUCCESS' ? (
                    <span className="badge badge-success">✓ Success</span>
                  ) : (
                    <span className="badge badge-error">✗ Failed</span>
                  )}
                </td>
                <td>{result.checkId || '—'}</td>
                <td>
                  {result.error ? (
                    <span className="error-text">{result.error}</span>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
