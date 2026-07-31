import { useMemo, useRef, useState } from 'react';
import {
  BUCKET_META,
  BUCKET_ORDER,
  buildAgingWorkbook,
  classifyBill,
  parseBillsWorkbook,
} from '../utils/billsAging';

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

function formatCurrency(value) {
  const amount = Number(value);
  return currencyFormatter.format(Number.isFinite(amount) ? amount : 0);
}

function formatDate(date) {
  if (!date) return '—';
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function bucketBadgeClass(bucket) {
  if (bucket === 'current') return 'badge badge-success';
  if (bucket === 'b1') return 'badge badge-aging-mild';
  if (bucket === 'b2') return 'badge badge-warning';
  return 'badge badge-error';
}

function bucketLabel(bill) {
  const meta = BUCKET_META[bill.bucket];
  if (bill.bucket === 'current') {
    return bill.daysOverdue === 0 ? 'Current (due today)' : 'Current';
  }
  return `${meta.shortLabel} · ${bill.daysOverdue}d`;
}

function compareValues(a, b, key, direction) {
  const dir = direction === 'asc' ? 1 : -1;
  let left = a[key];
  let right = b[key];

  if (key === 'invoiceDate' || key === 'dueDate') {
    left = left ? left.getTime() : 0;
    right = right ? right.getTime() : 0;
  } else if (key === 'amount' || key === 'daysOverdue') {
    left = Number(left) || 0;
    right = Number(right) || 0;
  } else {
    left = String(left || '').toLowerCase();
    right = String(right || '').toLowerCase();
  }

  if (left < right) return -1 * dir;
  if (left > right) return 1 * dir;
  return 0;
}

function downloadArrayBuffer(buffer, filename) {
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function ManageBillsPage() {
  const fileInputRef = useRef(null);
  const [mode, setMode] = useState('payables');
  const [payables, setPayables] = useState([]);
  const [receivables, setReceivables] = useState([]);
  const [importOpen, setImportOpen] = useState(false);
  const [importError, setImportError] = useState('');
  const [detectNotice, setDetectNotice] = useState('');
  const [importing, setImporting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [activeBucket, setActiveBucket] = useState('all');
  const [search, setSearch] = useState('');
  const [jobFilter, setJobFilter] = useState('');
  const [partyFilter, setPartyFilter] = useState('');
  const [sortKey, setSortKey] = useState('dueDate');
  const [sortDir, setSortDir] = useState('asc');

  const isReceivables = mode === 'receivables';
  const bills = isReceivables ? receivables : payables;
  const partyLabel = isReceivables ? 'Customer' : 'Vendor';
  const partyColumnLabel = isReceivables ? 'Customer' : 'Pay to';
  const itemNoun = isReceivables ? 'invoice' : 'bill';

  const classified = useMemo(
    () => bills.map((bill) => classifyBill(bill)),
    [bills]
  );

  const jobs = useMemo(() => {
    const set = new Set(classified.map((b) => b.job).filter(Boolean));
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [classified]);

  const parties = useMemo(() => {
    const set = new Set(classified.map((b) => b.counterparty).filter(Boolean));
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [classified]);

  const bucketStats = useMemo(() => {
    const stats = Object.fromEntries(
      BUCKET_ORDER.map((id) => [id, { count: 0, total: 0 }])
    );
    for (const bill of classified) {
      stats[bill.bucket].count += 1;
      stats[bill.bucket].total += bill.amount;
    }
    return stats;
  }, [classified]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return classified
      .filter((bill) => {
        if (activeBucket !== 'all' && bill.bucket !== activeBucket) return false;
        if (jobFilter && bill.job !== jobFilter) return false;
        if (partyFilter && bill.counterparty !== partyFilter) return false;
        if (!q) return true;
        return (
          bill.job.toLowerCase().includes(q) ||
          bill.counterparty.toLowerCase().includes(q) ||
          bill.billNumber.toLowerCase().includes(q) ||
          bill.title.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => compareValues(a, b, sortKey, sortDir));
  }, [
    classified,
    activeBucket,
    jobFilter,
    partyFilter,
    search,
    sortKey,
    sortDir,
  ]);

  function resetViewFilters() {
    setActiveBucket('all');
    setSearch('');
    setJobFilter('');
    setPartyFilter('');
  }

  function switchMode(nextMode) {
    if (nextMode === mode) return;
    setMode(nextMode);
    resetViewFilters();
    setDetectNotice('');
  }

  async function handleFile(file) {
    if (!file) return;
    setImporting(true);
    setImportError('');
    try {
      const buffer = await file.arrayBuffer();
      const { bills: parsed, format } = parseBillsWorkbook(buffer);
      if (parsed.length === 0) {
        setImportError(
          `No ${format === 'receivables' ? 'invoice' : 'bill'} rows with both an amount and a due date were found in this file.`
        );
        return;
      }

      if (format === 'receivables') {
        setReceivables(parsed);
      } else {
        setPayables(parsed);
      }
      setMode(format);
      resetViewFilters();
      setDetectNotice(
        `Detected: ${format === 'receivables' ? 'Receivables' : 'Payables'} format`
      );
      setImportOpen(false);
    } catch (err) {
      setImportError(err.message || 'Failed to import spreadsheet.');
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  function onDrop(event) {
    event.preventDefault();
    setDragOver(false);
    const file = event.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  function toggleSort(key) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'amount' || key === 'daysOverdue' ? 'desc' : 'asc');
    }
  }

  function exportAgingXlsx() {
    const asOf = new Date();
    const buffer = buildAgingWorkbook(filtered, mode, asOf);
    const stamp = asOf.toISOString().slice(0, 10);
    const prefix = isReceivables ? 'Aging-AR' : 'Aging-AP';
    downloadArrayBuffer(buffer, `${prefix}-${stamp}.xlsx`);
  }

  const sortIndicator = (key) => {
    if (sortKey !== key) return '';
    return sortDir === 'asc' ? ' ↑' : ' ↓';
  };

  const colCount = isReceivables ? 6 : 7;

  return (
    <div className="manage-bills">
      <header className="page-header manage-bills__header">
        <div>
          <h1>AR/AP</h1>
          <p>
            Import a payables or receivables export to sort items into Current
            and Aging buckets. Data stays in this browser session only.
          </p>
        </div>
        <div className="manage-bills__actions">
          <div className="manage-bills__mode" role="group" aria-label="Dataset mode">
            <button
              type="button"
              className={`manage-bills__mode-btn${mode === 'payables' ? ' is-active' : ''}`}
              onClick={() => switchMode('payables')}
            >
              Payables{payables.length > 0 ? ` (${payables.length})` : ''}
            </button>
            <button
              type="button"
              className={`manage-bills__mode-btn${mode === 'receivables' ? ' is-active' : ''}`}
              onClick={() => switchMode('receivables')}
            >
              Receivables{receivables.length > 0 ? ` (${receivables.length})` : ''}
            </button>
          </div>
          {bills.length > 0 && (
            <button type="button" className="btn btn-secondary" onClick={exportAgingXlsx}>
              Export
            </button>
          )}
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setImportError('');
              setImportOpen(true);
            }}
          >
            Import spreadsheet
          </button>
        </div>
      </header>

      {detectNotice && <p className="alert alert-success manage-bills__notice">{detectNotice}</p>}

      {bills.length === 0 ? (
        <div className="manage-bills__empty">
          <h2>No {isReceivables ? 'receivables' : 'payables'} imported yet</h2>
          <p>
            Upload an exported {isReceivables ? 'customer invoices' : 'bills'}{' '}
            spreadsheet (.xlsx or .csv). The page will classify each row by due
            date into Current, 0–30, 30–60, 60–90, and 90+ day buckets.
            Payables and receivables are kept as separate datasets.
          </p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setImportError('');
              setImportOpen(true);
            }}
          >
            Import spreadsheet
          </button>
        </div>
      ) : (
        <>
          <section className="manage-bills__kpis" aria-label="Aging totals">
            {BUCKET_ORDER.map((id) => (
              <div key={id} className={`manage-bills__kpi manage-bills__kpi--${id}`}>
                <h2>{BUCKET_META[id].label}</h2>
                <p className="manage-bills__kpi-value">
                  {formatCurrency(bucketStats[id].total)}
                </p>
                <p className="manage-bills__kpi-count">
                  {bucketStats[id].count} {itemNoun}
                  {bucketStats[id].count === 1 ? '' : 's'}
                </p>
              </div>
            ))}
          </section>

          <div className="manage-bills__tabs" role="tablist" aria-label="Aging buckets">
            <button
              type="button"
              role="tab"
              aria-selected={activeBucket === 'all'}
              className={`manage-bills__tab${activeBucket === 'all' ? ' is-active' : ''}`}
              onClick={() => setActiveBucket('all')}
            >
              All ({classified.length})
            </button>
            {BUCKET_ORDER.map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={activeBucket === id}
                className={`manage-bills__tab${activeBucket === id ? ' is-active' : ''}`}
                onClick={() => setActiveBucket(id)}
              >
                {BUCKET_META[id].shortLabel} ({bucketStats[id].count})
              </button>
            ))}
          </div>

          <div className="manage-bills__filters">
            <label className="manage-bills__filter">
              Search
              <input
                type="search"
                className="form-input"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={`Job, ${partyLabel.toLowerCase()}, or ${isReceivables ? 'invoice' : 'bill'} #`}
              />
            </label>
            <label className="manage-bills__filter">
              Job
              <select
                className="form-select"
                value={jobFilter}
                onChange={(e) => setJobFilter(e.target.value)}
              >
                <option value="">All jobs</option>
                {jobs.map((job) => (
                  <option key={job} value={job}>
                    {job}
                  </option>
                ))}
              </select>
            </label>
            <label className="manage-bills__filter">
              {partyLabel}
              <select
                className="form-select"
                value={partyFilter}
                onChange={(e) => setPartyFilter(e.target.value)}
              >
                <option value="">All {partyLabel.toLowerCase()}s</option>
                {parties.map((party) => (
                  <option key={party} value={party}>
                    {party}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="manage-bills__table-wrap">
            <table className="data-table manage-bills__table">
              <thead>
                <tr>
                  <th>
                    <button type="button" className="manage-bills__th" onClick={() => toggleSort('job')}>
                      Job{sortIndicator('job')}
                    </button>
                  </th>
                  <th>
                    <button type="button" className="manage-bills__th" onClick={() => toggleSort('billNumber')}>
                      {isReceivables ? 'Invoice #' : 'Bill #'}
                      {sortIndicator('billNumber')}
                    </button>
                  </th>
                  <th>
                    <button
                      type="button"
                      className="manage-bills__th"
                      onClick={() => toggleSort('counterparty')}
                    >
                      {partyColumnLabel}
                      {sortIndicator('counterparty')}
                    </button>
                  </th>
                  {!isReceivables && (
                    <th>
                      <button
                        type="button"
                        className="manage-bills__th"
                        onClick={() => toggleSort('invoiceDate')}
                      >
                        Invoice date{sortIndicator('invoiceDate')}
                      </button>
                    </th>
                  )}
                  <th>
                    <button type="button" className="manage-bills__th" onClick={() => toggleSort('dueDate')}>
                      {isReceivables ? 'Deadline' : 'Due date'}
                      {sortIndicator('dueDate')}
                    </button>
                  </th>
                  <th>
                    <button
                      type="button"
                      className="manage-bills__th"
                      onClick={() => toggleSort('daysOverdue')}
                    >
                      Aging{sortIndicator('daysOverdue')}
                    </button>
                  </th>
                  <th className="text-right">
                    <button type="button" className="manage-bills__th" onClick={() => toggleSort('amount')}>
                      Amount{sortIndicator('amount')}
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={colCount}>No {itemNoun}s match the current filters.</td>
                  </tr>
                ) : (
                  filtered.map((bill) => (
                    <tr
                      key={`${bill.billNumber}-${bill.job}-${bill.dueDate.toISOString()}-${bill.amount}-${bill.counterparty}`}
                    >
                      <td>{bill.job || '—'}</td>
                      <td>{bill.billNumber || '—'}</td>
                      <td>{bill.counterparty || '—'}</td>
                      {!isReceivables && <td>{formatDate(bill.invoiceDate)}</td>}
                      <td>{formatDate(bill.dueDate)}</td>
                      <td>
                        <span className={bucketBadgeClass(bill.bucket)}>
                          {bucketLabel(bill)}
                        </span>
                      </td>
                      <td className="text-right manage-bills__amount">
                        {formatCurrency(bill.amount)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <p className="manage-bills__footer-meta">
            Showing {filtered.length} of {classified.length} {itemNoun}s
          </p>
        </>
      )}

      {importOpen && (
        <div
          className="manage-bills__modal-backdrop"
          role="presentation"
          onClick={() => !importing && setImportOpen(false)}
        >
          <div
            className="manage-bills__modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="manage-bills-import-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="manage-bills-import-title">Import spreadsheet</h2>
            <p>
              Drop a payables or receivables export (.xlsx or .csv). Format is
              auto-detected. Each import replaces that mode&apos;s in-memory list
              only.
            </p>
            <div
              className={`manage-bills__dropzone${dragOver ? ' is-dragover' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
            >
              <p>Drag and drop a file here, or choose one.</p>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={importing}
                onClick={() => fileInputRef.current?.click()}
              >
                {importing ? 'Importing…' : 'Choose file'}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                hidden
                onChange={(e) => handleFile(e.target.files?.[0])}
              />
            </div>
            {importError && <p className="alert alert-error">{importError}</p>}
            <div className="manage-bills__modal-actions">
              <button
                type="button"
                className="btn btn-secondary"
                disabled={importing}
                onClick={() => setImportOpen(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
