const XLSX = require('xlsx');
const { STANDARD_DAILY_PAY_CODES } = require('../config/payCodeMapping');

const HEADER_PATTERNS = {
  dateWorked: /^(date[_\s-]?worked|work\s*date|date)$/i,
  employeeCode: /^(employee[_\s-]?code|emp\s*#|employee\s*id)$/i,
  worker: /^(worker|worker\s*name|employee\s*name|name)$/i,
  jobSite: /^(job[_\s-]?(site|code)|project|site)$/i,
  payCode: /^(pay[_\s-]?code|code|type)$/i,
  hours: /^(hours[_\s-]?worked|hours|qty|quantity)$/i,
  payPeriod: /^(pay[_\s-]?period|period)$/i,
};

function normalizeHeader(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeName(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function parseImportDate(value) {
  if (value == null || value === '') return null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return null;
    return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
  }

  const raw = String(value).trim();
  if (!raw) return null;

  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const us = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (us) {
    const month = Number(us[1]);
    const day = Number(us[2]);
    let year = Number(us[3]);
    if (year < 100) year += 2000;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  const fallback = new Date(raw);
  if (Number.isNaN(fallback.getTime())) return null;
  return `${fallback.getFullYear()}-${String(fallback.getMonth() + 1).padStart(2, '0')}-${String(fallback.getDate()).padStart(2, '0')}`;
}

function parseHours(value) {
  if (value == null || value === '') return 0;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const cleaned = String(value).replace(/[,\s]/g, '');
  const hours = Number(cleaned);
  return Number.isFinite(hours) ? hours : null;
}

function detectHeaderMap(rows) {
  const scanLimit = Math.min(5, rows.length);
  for (let i = 0; i < scanLimit; i += 1) {
    const row = rows[i] || [];
    const cells = row.map((cell) => normalizeHeader(cell));
    if (!cells.some(Boolean)) continue;

    const map = {};
    cells.forEach((cell, index) => {
      for (const [key, pattern] of Object.entries(HEADER_PATTERNS)) {
        if (pattern.test(cell)) {
          map[key] = index;
        }
      }
    });

    const hasRequired =
      map.dateWorked != null &&
      (map.worker != null || map.employeeCode != null) &&
      map.jobSite != null &&
      map.payCode != null &&
      map.hours != null;

    if (hasRequired) {
      return { headerRowIndex: i, map };
    }
  }
  return null;
}

function parseWorkerName(raw) {
  const text = String(raw || '').trim();
  if (!text) return { firstName: '', lastName: '' };
  if (text.includes(',')) {
    const [last, first] = text.split(',').map((part) => part.trim());
    return { firstName: first || '', lastName: last || '' };
  }
  const parts = text.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

function readWorkbookBuffer(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true, raw: true });
  const sheetName =
    workbook.SheetNames.find((name) => /time|entr|hour/i.test(name)) ||
    workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
}

function parseEntriesWorkbook(buffer) {
  const rows = readWorkbookBuffer(buffer);
  const detected = detectHeaderMap(rows);
  if (!detected) {
    const error = new Error(
      'Could not detect required columns (date_worked, worker, job_site, pay_code, hours)'
    );
    error.statusCode = 400;
    throw error;
  }

  const { headerRowIndex, map } = detected;
  const parsedRows = [];
  const errors = [];

  for (let i = headerRowIndex + 1; i < rows.length; i += 1) {
    const row = rows[i] || [];
    const rowNumber = i + 1;
    const dateWorked = parseImportDate(row[map.dateWorked]);
    const employeeCode =
      map.employeeCode != null ? String(row[map.employeeCode] || '').trim() : '';
    const workerRaw = map.worker != null ? String(row[map.worker] || '').trim() : '';
    const jobSiteRaw = String(row[map.jobSite] || '').trim();
    const payCode = String(row[map.payCode] || '')
      .trim()
      .toUpperCase();
    const hours = parseHours(row[map.hours]);
    const payPeriodRaw =
      map.payPeriod != null ? String(row[map.payPeriod] || '').trim() : '';

    const isBlank =
      !dateWorked &&
      !employeeCode &&
      !workerRaw &&
      !jobSiteRaw &&
      !payCode &&
      (hours == null || hours === 0);
    if (isBlank) continue;

    const rowErrors = [];
    if (!dateWorked) rowErrors.push('invalid or missing date_worked');
    if (!employeeCode && !workerRaw) rowErrors.push('worker or employee_code required');
    if (!jobSiteRaw) rowErrors.push('missing job_site');
    if (!payCode) rowErrors.push('missing pay_code');
    if (!STANDARD_DAILY_PAY_CODES.includes(payCode)) {
      rowErrors.push(`invalid pay_code "${payCode}"`);
    }
    if (hours == null) rowErrors.push('invalid hours');
    if (hours != null && hours < 0) rowErrors.push('hours cannot be negative');

    const workerName = parseWorkerName(workerRaw);
    parsedRows.push({
      rowNumber,
      dateWorked,
      employeeCode: employeeCode || null,
      workerName: workerRaw || null,
      firstName: workerName.firstName,
      lastName: workerName.lastName,
      jobSiteRaw,
      payCode,
      hours: hours ?? 0,
      payPeriodRaw: payPeriodRaw || null,
      errors: rowErrors,
    });

    if (rowErrors.length) {
      errors.push({ rowNumber, reasons: rowErrors });
    }
  }

  return {
    rowCount: parsedRows.length,
    rows: parsedRows,
    errors,
  };
}

function buildImportTemplateWorkbook() {
  const data = [
    ['date_worked', 'employee_code', 'worker_name', 'job_code', 'pay_code', 'hours'],
    ['2026-07-07', 'E100', 'Rivera, Alex', 'PW-2024', 'REGULAR', 8],
    ['2026-07-07', 'E100', 'Rivera, Alex', 'PW-2024', 'OT', 2],
  ];
  const sheet = XLSX.utils.aoa_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'TimeEntries');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = {
  parseEntriesWorkbook,
  buildImportTemplateWorkbook,
  parseImportDate,
  normalizeName,
};
