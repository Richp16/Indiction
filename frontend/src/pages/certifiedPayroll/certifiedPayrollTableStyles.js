export const sectionStyle = {
  background: '#fff',
  border: '1px solid #e5e2dc',
  borderRadius: 8,
  padding: '1.25rem',
  marginBottom: '1.5rem',
  boxShadow: '0 1px 2px rgba(40, 37, 29, 0.06)',
};

export const sectionTitleStyle = {
  margin: '0 0 1rem',
  fontSize: '1.125rem',
  fontWeight: 600,
};

export const tableWrapStyle = { overflowX: 'auto' };

export const tableStyle = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '0.9rem',
};

export const thStyle = {
  textAlign: 'left',
  padding: '0.6rem 0.75rem',
  borderBottom: '2px solid #d4d1ca',
  background: '#f3f0ec',
  fontWeight: 700,
  whiteSpace: 'nowrap',
};

export const thRightStyle = { ...thStyle, textAlign: 'right' };

export const tdStyle = {
  padding: '0.6rem 0.75rem',
  borderBottom: '1px solid #ece9e4',
  verticalAlign: 'middle',
};

export const tdRightStyle = { ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };

export const workerNameCellStyle = { ...tdStyle, minWidth: 160, textAlign: 'left' };
