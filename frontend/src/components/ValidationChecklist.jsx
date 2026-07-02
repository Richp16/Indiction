export default function ValidationChecklist({ items, loading, error }) {
  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 'var(--space-6)' }}>
        <span className="spinner" aria-label="Validating payroll" />
        <p className="form-hint" style={{ marginTop: 'var(--space-3)' }}>
          Running validation checks…
        </p>
      </div>
    );
  }

  if (error) {
    return <div className="alert alert-error">{error}</div>;
  }

  if (!items || items.length === 0) {
    return (
      <div className="validation-ok">
        ✅ All validation checks passed — ready to submit
      </div>
    );
  }

  const errors = items.filter((item) => item.type === 'error');
  const warnings = items.filter((item) => item.type === 'warning');

  if (errors.length === 0 && warnings.length === 0) {
    return (
      <div className="validation-ok">
        ✅ All validation checks passed — ready to submit
      </div>
    );
  }

  return (
    <ul className="validation-list">
      {errors.map((item, index) => (
        <li key={`error-${index}`} className="validation-item validation-item-error">
          <span>❌</span>
          <span>
            {item.workerName ? `${item.workerName}: ` : ''}
            {item.message}
          </span>
        </li>
      ))}
      {warnings.map((item, index) => (
        <li key={`warning-${index}`} className="validation-item validation-item-warning">
          <span>⚠️</span>
          <span>
            {item.workerName ? `${item.workerName}: ` : ''}
            {item.message}
          </span>
        </li>
      ))}
    </ul>
  );
}
