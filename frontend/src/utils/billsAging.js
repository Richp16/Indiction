import * as XLSX from 'xlsx';

const PAYABLES_HEADERS = {
  job: /^job$/i,
  billNumber: /^bill\s*#?$/i,
  title: /^bill\s*title$/i,
  counterparty: /^pay\s*to$/i,
  amount: /^bill\s*amount$/i,
  invoiceDate: /^invoice\s*date$/i,
  dueDate: /due\s*date/i,
  status: /^bill\s*status$/i,
  costCodes: /^cost\s*codes?$/i,
};

const RECEIVABLES_HEADERS = {
  job: /^job$/i,
  billNumber: /^id\s*#?$/i,
  title: /^title$/i,
  counterparty: /^owner\s*name$/i,
  amount: /^invoice\s*balance$/i,
  dueDate: /^deadline$/i,
  status: /^status$/i,
  accountingStatus: /^accounting\s*status$/i,
};

export const EXPORT_BUCKET_HEADERS = {
  current: 'Current',
  b1: '1–30 Days',
  b2: '31–60 Days',
  b3: '61–90 Days',
  b4: '90+ Days',
};

function normalizeHeader(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cellToString(value) {
  if (value == null) return '';
  return String(value).trim();
}

/**
 * Coerce Excel serials and common date strings to Date at local midnight.
 * @returns {Date | null}
 */
export function parseBillDate(value) {
  if (value == null || value === '') return null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return null;
    return new Date(parsed.y, parsed.m - 1, parsed.d);
  }

  const raw = String(value).trim();
  if (!raw) return null;

  const us = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (us) {
    const month = Number(us[1]);
    const day = Number(us[2]);
    let year = Number(us[3]);
    if (year < 100) year += 2000;
    const date = new Date(year, month - 1, day);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const date = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const fallback = new Date(raw);
  if (Number.isNaN(fallback.getTime())) return null;
  return new Date(fallback.getFullYear(), fallback.getMonth(), fallback.getDate());
}

/**
 * Parse bill amount; allows negatives (credits). Returns null if unparseable.
 */
export function parseBillAmount(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;

  const cleaned = String(value)
    .replace(/[$,\s]/g, '')
    .replace(/^\((.*)\)$/, '-$1');
  if (!cleaned || cleaned === '-') return null;
  const amount = Number(cleaned);
  return Number.isFinite(amount) ? amount : null;
}

function findSheet(workbook) {
  const preferred = workbook.SheetNames.find((name) =>
    /payment|bill|invoice|customer/i.test(name)
  );
  return preferred || workbook.SheetNames[0] || null;
}

function detectFormatFromHeaders(cells) {
  const hasOwner = cells.some((c) => /^owner\s*name$/i.test(c));
  const hasBalance = cells.some((c) => /^invoice\s*balance$/i.test(c));
  if (hasOwner && hasBalance) return 'receivables';

  const hasBillAmount = cells.some((c) => /^bill\s*amount$/i.test(c));
  const hasPayTo = cells.some((c) => /^pay\s*to$/i.test(c));
  if (hasBillAmount && hasPayTo) return 'payables';

  const hasJob = cells.some((c) => /^job$/i.test(c));
  const hasId = cells.some((c) => /^id\s*#?$/i.test(c));
  const hasDeadline = cells.some((c) => /^deadline$/i.test(c));
  if (hasJob && hasId && hasDeadline) return 'receivables';

  const hasBillNum = cells.some((c) => /^bill\s*#?$/i.test(c));
  const hasDue = cells.some((c) => /due\s*date/i.test(c));
  if (hasJob && hasBillNum && hasDue) return 'payables';

  return null;
}

function findHeaderRow(rows) {
  const scanLimit = Math.min(5, rows.length);
  for (let i = 0; i < scanLimit; i += 1) {
    const cells = (rows[i] || []).map(normalizeHeader);
    const format = detectFormatFromHeaders(cells);
    if (format) return { index: i, format };
  }
  return { index: -1, format: null };
}

function mapHeaderIndexes(headerRow, format) {
  const patterns = format === 'receivables' ? RECEIVABLES_HEADERS : PAYABLES_HEADERS;
  const indexes = {};
  headerRow.forEach((raw, index) => {
    const header = normalizeHeader(raw);
    if (!header) return;
    for (const [key, pattern] of Object.entries(patterns)) {
      if (indexes[key] == null && pattern.test(header)) {
        indexes[key] = index;
      }
    }
  });
  return indexes;
}

function parseRows(rows, headerIndex, format) {
  const indexes = mapHeaderIndexes(rows[headerIndex], format);
  if (
    indexes.job == null ||
    indexes.billNumber == null ||
    indexes.dueDate == null ||
    indexes.amount == null
  ) {
    throw new Error(
      format === 'receivables'
        ? 'Header row is missing required columns (Job, ID#, Invoice Balance, Deadline).'
        : 'Header row is missing required columns (Job, Bill #, Bill amount, Due date).'
    );
  }

  const bills = [];
  for (let r = headerIndex + 1; r < rows.length; r += 1) {
    const row = rows[r] || [];
    const amount = parseBillAmount(row[indexes.amount]);
    const dueDate = parseBillDate(row[indexes.dueDate]);
    if (amount == null || !dueDate) continue;

    bills.push({
      job: cellToString(row[indexes.job]),
      billNumber: cellToString(row[indexes.billNumber]),
      title: indexes.title != null ? cellToString(row[indexes.title]) : '',
      counterparty:
        indexes.counterparty != null ? cellToString(row[indexes.counterparty]) : '',
      amount,
      invoiceDate:
        indexes.invoiceDate != null ? parseBillDate(row[indexes.invoiceDate]) : null,
      dueDate,
      status: indexes.status != null ? cellToString(row[indexes.status]) : '',
      costCodes: indexes.costCodes != null ? cellToString(row[indexes.costCodes]) : '',
      accountingStatus:
        indexes.accountingStatus != null
          ? cellToString(row[indexes.accountingStatus])
          : '',
      format,
    });
  }

  return bills;
}

/**
 * Parse a bills/invoices export workbook/CSV ArrayBuffer.
 * @returns {{ bills: object[], format: 'payables' | 'receivables' }}
 * @throws {Error} when header row cannot be detected
 */
export function parseBillsWorkbook(fileBuffer) {
  const workbook = XLSX.read(fileBuffer, {
    type: 'array',
    cellDates: true,
    raw: true,
  });

  const sheetName = findSheet(workbook);
  if (!sheetName) {
    throw new Error('No worksheets found in the uploaded file.');
  }

  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: '',
    raw: true,
  });

  if (!rows.length) {
    throw new Error('The spreadsheet is empty.');
  }

  const { index: headerIndex, format } = findHeaderRow(rows);
  if (headerIndex < 0 || !format) {
    throw new Error(
      'Could not detect a payables or receivables header row. Expected Job + Bill # + Due date, or OwnerName + Invoice Balance + Deadline.'
    );
  }

  const bills = parseRows(rows, headerIndex, format);
  return { bills, format };
}

/**
 * Classify a bill into an aging bucket relative to referenceDate.
 */
export function classifyBill(bill, referenceDate = new Date()) {
  const ref = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate()
  );
  const due = new Date(
    bill.dueDate.getFullYear(),
    bill.dueDate.getMonth(),
    bill.dueDate.getDate()
  );
  const daysOverdue = Math.floor((ref.getTime() - due.getTime()) / 86400000);

  let bucket = 'current';
  if (daysOverdue > 90) bucket = 'b4';
  else if (daysOverdue > 60) bucket = 'b3';
  else if (daysOverdue > 30) bucket = 'b2';
  else if (daysOverdue > 0) bucket = 'b1';

  return { ...bill, daysOverdue, bucket };
}

export const BUCKET_META = {
  current: { id: 'current', label: 'Current', shortLabel: 'Current' },
  b1: { id: 'b1', label: '0–30 days', shortLabel: '0–30' },
  b2: { id: 'b2', label: '30–60 days', shortLabel: '30–60' },
  b3: { id: 'b3', label: '60–90 days', shortLabel: '60–90' },
  b4: { id: 'b4', label: '90+ days', shortLabel: '90+' },
};

export const BUCKET_ORDER = ['current', 'b1', 'b2', 'b3', 'b4'];

/**
 * Build an Aging AR/AP workbook matching the company export layout.
 * @param {object[]} bills classified + filtered/sorted rows currently in view
 * @param {'payables' | 'receivables'} mode
 * @param {Date} [asOfDate]
 * @returns {ArrayBuffer}
 */
export function buildAgingWorkbook(bills, mode, asOfDate = new Date()) {
  const asOf = new Date(asOfDate.getFullYear(), asOfDate.getMonth(), asOfDate.getDate());
  const counterpartyHeader = mode === 'receivables' ? 'Customer Name' : 'Vendor Name';
  const sheetName = mode === 'receivables' ? 'Aging AR' : 'Aging AP';

  const header = [
    'Project Name',
    counterpartyHeader,
    'Invoice #',
    'Invoice Date',
    'Due Date',
    'Amount',
    null,
    'Days Outstanding',
    EXPORT_BUCKET_HEADERS.current,
    EXPORT_BUCKET_HEADERS.b1,
    EXPORT_BUCKET_HEADERS.b2,
    EXPORT_BUCKET_HEADERS.b3,
    EXPORT_BUCKET_HEADERS.b4,
  ];

  const aoa = [
    [null, null, null, null, null, null, null, asOf],
    header,
    [],
  ];

  let amountTotal = 0;
  const bucketTotals = {
    current: 0,
    b1: 0,
    b2: 0,
    b3: 0,
    b4: 0,
  };

  for (const bill of bills) {
    const amount = Number(bill.amount) || 0;
    const bucketAmounts = {
      current: 0,
      b1: 0,
      b2: 0,
      b3: 0,
      b4: 0,
    };
    bucketAmounts[bill.bucket] = amount;
    amountTotal += amount;
    bucketTotals[bill.bucket] += amount;

    aoa.push([
      bill.job || '',
      bill.counterparty || '',
      bill.billNumber || '',
      bill.invoiceDate || null,
      bill.dueDate || null,
      amount,
      null,
      bill.daysOverdue,
      bucketAmounts.current,
      bucketAmounts.b1,
      bucketAmounts.b2,
      bucketAmounts.b3,
      bucketAmounts.b4,
    ]);
  }

  const bucketSum =
    bucketTotals.current +
    bucketTotals.b1 +
    bucketTotals.b2 +
    bucketTotals.b3 +
    bucketTotals.b4;
  // Amount and bucket columns are the same total sliced differently.
  if (Math.abs(amountTotal - bucketSum) > 1e-9) {
    throw new Error(
      `Aging export totals mismatch: Amount ${amountTotal} !== bucket sum ${bucketSum}`
    );
  }

  // Reference Aging AR has no totals row — append Totals directly under last data row.
  aoa.push([
    'Totals',
    null,
    null,
    null,
    null,
    amountTotal,
    null,
    null,
    bucketTotals.current,
    bucketTotals.b1,
    bucketTotals.b2,
    bucketTotals.b3,
    bucketTotals.b4,
  ]);

  const worksheet = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true });
  if (worksheet.H1) {
    worksheet.H1.t = 'd';
    worksheet.H1.v = asOf;
    worksheet.H1.z = 'm/d/yy';
  }

  // Community SheetJS strips rich cell styles on write; skip bold styling.

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  return XLSX.write(workbook, { type: 'array', bookType: 'xlsx', cellDates: true });
}
