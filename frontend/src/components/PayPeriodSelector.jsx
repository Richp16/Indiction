const toolbarStyle = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '0.75rem',
  alignItems: 'center',
  marginBottom: '0.75rem',
};

const labelStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.35rem',
  fontSize: '0.875rem',
  fontWeight: 600,
  color: '#444',
};

const selectStyle = {
  minWidth: 260,
  padding: '0.5rem 0.75rem',
  border: '1px solid #d4d1ca',
  borderRadius: 6,
  background: '#fff',
  fontWeight: 400,
};

/**
 * Shared pay-period dropdown used on Payroll and Summary pages.
 */
export default function PayPeriodSelector({
  periods,
  selectedPayPeriodId,
  onChange,
  disabled = false,
}) {
  return (
    <div style={toolbarStyle}>
      <label style={labelStyle}>
        Pay period
        <select
          aria-label="Pay period"
          value={selectedPayPeriodId}
          onChange={(event) => onChange(event.target.value)}
          style={selectStyle}
          disabled={disabled || periods.length === 0}
        >
          {periods.length === 0 ? (
            <option value="">No pay periods with recorded hours yet</option>
          ) : (
            periods.map((period) => (
              <option key={period.id} value={period.id}>
                {period.label}
                {period.isCurrent ? ' (Current)' : ''}
              </option>
            ))
          )}
        </select>
      </label>
    </div>
  );
}
