import { useState, useMemo } from 'react';

const COLUMNS = [
  { key: 'employeeId', label: 'Employee ID', type: 'text' },
  { key: 'firstName', label: 'First Name', type: 'text' },
  { key: 'lastName', label: 'Last Name', type: 'text' },
  { key: 'jobSite', label: 'Job Site', type: 'text' },
  { key: 'week1Regular', label: 'Wk 1 Reg', type: 'hours' },
  { key: 'week1Overtime', label: 'Wk 1 OT', type: 'hours' },
  { key: 'week1Total', label: 'Wk 1 Total', type: 'hours' },
  { key: 'week2Regular', label: 'Wk 2 Reg', type: 'hours' },
  { key: 'week2Overtime', label: 'Wk 2 OT', type: 'hours' },
  { key: 'week2Total', label: 'Wk 2 Total', type: 'hours' },
  { key: 'totalRegular', label: 'Total Reg', type: 'hours' },
  { key: 'totalOvertime', label: 'Total OT', type: 'hours' },
  { key: 'totalHours', label: 'Total Hrs', type: 'hours' },
  { key: 'truckReimbursement', label: 'Truck Reimb.', type: 'money' },
  { key: 'otherReimbursements', label: 'Other Reimb.', type: 'money' },
  { key: 'total', label: 'Total', type: 'money' },
];

function formatCell(value, type) {
  const num = parseFloat(value) || 0;
  if (type === 'hours') return num.toFixed(1);
  if (type === 'money') return `$${num.toFixed(2)}`;
  return value ?? '—';
}

export default function SummaryTable({ rows }) {
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState('asc');

  const totals = useMemo(() => {
    const sums = {};
    for (const col of COLUMNS) {
      if (col.type === 'text') {
        sums[col.key] = null;
      } else {
        sums[col.key] = rows.reduce(
          (acc, row) => acc + (parseFloat(row[col.key]) || 0),
          0
        );
      }
    }
    return sums;
  }, [rows]);

  function handleSort(key) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  if (!rows || rows.length === 0) {
    return (
      <p className="form-hint" style={{ textAlign: 'center', padding: 'var(--space-8)' }}>
        No summary data for this pay period
      </p>
    );
  }

  const displayRows = sortKey
    ? [...rows].sort((a, b) => {
        const col = COLUMNS.find((c) => c.key === sortKey);
        const aVal = a[sortKey];
        const bVal = b[sortKey];
        let cmp;
        if (col?.type === 'text') {
          cmp = String(aVal || '').localeCompare(String(bVal || ''));
        } else {
          cmp = (parseFloat(aVal) || 0) - (parseFloat(bVal) || 0);
        }
        return sortDir === 'asc' ? cmp : -cmp;
      })
    : rows;

  return (
    <div className="table-wrapper">
      <table className="data-table">
        <thead>
          <tr>
            {COLUMNS.map((col) => (
              <th
                key={col.key}
                className={`sortable${col.type !== 'text' ? ' text-right' : ''}`}
                onClick={() => handleSort(col.key)}
              >
                {col.label}
                {sortKey === col.key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {displayRows.map((row, index) => (
            <tr key={`${row.employeeId}-${row.jobSite}-${index}`}>
              {COLUMNS.map((col) => (
                <td
                  key={col.key}
                  className={col.type !== 'text' ? 'text-right' : undefined}
                >
                  {formatCell(row[col.key], col.type)}
                </td>
              ))}
            </tr>
          ))}
          <tr className="totals-row">
            {COLUMNS.map((col) => (
              <td
                key={col.key}
                className={col.type !== 'text' ? 'text-right' : undefined}
              >
                {col.key === 'employeeId'
                  ? 'Totals'
                  : col.type === 'text'
                    ? ''
                    : formatCell(totals[col.key], col.type)}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
