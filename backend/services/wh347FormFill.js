/**
 * Fill the WH-347 AcroForm template via named fields (pdf-lib).
 * Not yet wired into the certified-payroll export route.
 *
 * Text is shrink-to-fit via fitTextToField so narrow columns never clip.
 */

const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const { wh347FieldMap } = require('../config/wh347FieldMap');

const TEMPLATE_PATH = path.join(__dirname, '..', 'templates', 'wh347-fillable.pdf');
const WORKERS_PER_PAGE = 8;

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const DEFAULT_MAX_FONT = 7;
const DEFAULT_MIN_FONT = 4;
const FIELD_PAD_X = 1;

function textValue(value) {
  if (value == null || value === '') return '';
  return String(value);
}

function moneyOrHours(value) {
  if (value == null || value === '') return '';
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  if (n === 0) return '0';
  // Keep two decimals for money-like values when present in the input string.
  if (typeof value === 'string' && value.includes('.')) {
    return (Math.round(n * 100) / 100).toFixed(2);
  }
  // Prefer compact hour display (avoid "11.75" → forced ellipsis in ~11pt columns).
  if (!Number.isInteger(n)) {
    const rounded = Math.round(n * 100) / 100;
    return String(rounded);
  }
  return String(n);
}

function parseIsoDate(value) {
  const day = String(value || '').split('T')[0];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const date = new Date(`${day}T12:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Unpadded M/D/YY — WH-347 date widgets are ~11–13pt wide (maxLength often 7). */
function formatShortDate(date) {
  const yy = String(date.getUTCFullYear()).slice(-2);
  return `${date.getUTCMonth() + 1}/${date.getUTCDate()}/${yy}`;
}

/** Day 1 = weekEnding − 6 … Day 7 = weekEnding (UTC). */
function buildWeekDays(weekEndingDate) {
  const end = parseIsoDate(weekEndingDate);
  if (!end) return [];

  const days = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    const d = new Date(end);
    d.setUTCDate(end.getUTCDate() - offset);
    days.push({
      date: d,
      label: WEEKDAY_SHORT[d.getUTCDay()],
      key: WEEKDAY_KEYS[d.getUTCDay()],
      iso: d.toISOString().slice(0, 10),
    });
  }
  return days;
}

function splitPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length >= 10) {
    return {
      areaCode: digits.slice(0, 3),
      telPart1: digits.slice(3, 6),
      telPart2: digits.slice(6, 10),
    };
  }
  return { areaCode: '', telPart1: '', telPart2: digits };
}

function getSupplement(supplementsByWorker, workerId) {
  if (!supplementsByWorker) return {};
  if (typeof supplementsByWorker.get === 'function') {
    return supplementsByWorker.get(workerId) || {};
  }
  return supplementsByWorker[workerId] || {};
}

function getWidgetBox(field) {
  try {
    const widgets = field.acroField.getWidgets();
    if (!widgets?.length) return null;
    return widgets[0].getRectangle();
  } catch {
    return null;
  }
}

function truncateToWidth(font, text, fontSize, maxWidth) {
  if (font.widthOfTextAtSize(text, fontSize) <= maxWidth) return text;

  const ellipsis = '…';
  if (font.widthOfTextAtSize(ellipsis, fontSize) > maxWidth) return ellipsis;

  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const candidate = `${text.slice(0, mid)}${ellipsis}`;
    if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }

  return lo <= 0 ? ellipsis : `${text.slice(0, lo)}${ellipsis}`;
}

/**
 * Shrink text to fit a PDF text field's widget box (Adobe-like auto size).
 *
 * 1. Sets font size 0 first (viewer auto-size when unflattened).
 * 2. Measures with pdf-lib font metrics and sets an explicit size so
 *    updateFieldAppearances / flatten bake a consistent appearance.
 * 3. Truncates with ellipsis only if it still overflows at minFontSize.
 *
 * @returns {{ text: string, fontSize: number, truncated: boolean, original: string }}
 */
function fitTextToField(pdfDoc, field, text, options = {}) {
  const {
    maxFontSize = DEFAULT_MAX_FONT,
    minFontSize = DEFAULT_MIN_FONT,
    font,
    padding = FIELD_PAD_X,
  } = options;

  const original = textValue(text);
  const fieldName = (() => {
    try {
      return field.getName();
    } catch {
      return '(unknown)';
    }
  })();

  if (!original) {
    try {
      field.setText('');
    } catch {
      // ignore empty clear failures
    }
    return { text: '', fontSize: maxFontSize, truncated: false, original: '' };
  }

  // Pass 1: DA font size 0 → PDF viewers auto-size when the form stays editable.
  // pdf-lib 1.17.1 allows 0 and uses computeFontSize when appearances update.
  try {
    field.setFontSize(0);
  } catch {
    // Missing /DA Tf operator on some fields — continue with measured size.
  }

  const box = getWidgetBox(field);
  // Tiny day/hour widgets (~11pt) cannot spare 2pt padding each side.
  const effectivePad =
    box != null
      ? Math.min(padding, Math.max(0.25, box.width * 0.05))
      : padding;
  const usableWidth = box ? Math.max(1, box.width - effectivePad * 2) : null;
  const usableHeight = box ? Math.max(minFontSize, box.height - 1) : maxFontSize;

  let size = Math.min(maxFontSize, usableHeight);
  let display = original;
  let truncated = false;

  if (font && usableWidth != null) {
    while (size > minFontSize && font.widthOfTextAtSize(display, size) > usableWidth) {
      size = Math.round((size - 0.5) * 10) / 10;
    }
    size = Math.max(minFontSize, size);

    if (font.widthOfTextAtSize(display, size) > usableWidth) {
      const fitted = truncateToWidth(font, display, size, usableWidth);
      truncated = fitted !== display;
      if (truncated) {
        console.warn(
          `[wh347FormFill] Truncated field "${fieldName}": ` +
            `original="${original}" → truncated="${fitted}" ` +
            `(fontSize=${size}, boxWidth=${box?.width?.toFixed?.(1)})`
        );
      }
      display = fitted;
    }
  }

  // Pass 2: bake an explicit size for flatten / updateFieldAppearances.
  try {
    field.setFontSize(size);
  } catch {
    // Some fields reject DA updates — text still set below.
  }

  try {
    const maxLen = field.getMaxLength();
    if (maxLen != null && display.length > maxLen) {
      field.setMaxLength(Math.max(display.length, maxLen));
    }
  } catch {
    // ignore
  }

  field.setText(display);
  return { text: display, fontSize: size, truncated, original };
}

function setText(ctx, name, value, fitOptions = {}) {
  if (!name) return;
  const { form, pdfDoc, font, warnings } = ctx;
  try {
    const field = form.getTextField(name);
    const result = fitTextToField(pdfDoc, field, value, {
      font,
      maxFontSize: fitOptions.maxFontSize ?? DEFAULT_MAX_FONT,
      minFontSize: fitOptions.minFontSize ?? DEFAULT_MIN_FONT,
      padding: fitOptions.padding ?? FIELD_PAD_X,
    });
    if (result.truncated) {
      warnings.push(`truncated:${name}:${result.original}→${result.text}`);
    }
  } catch (err) {
    warnings.push(`text:${name}: ${err.message}`);
    console.warn(`[wh347FormFill] Could not set text field "${name}": ${err.message}`);
  }
}

function setCheck(form, name, checked, warnings) {
  if (!name) return;
  try {
    const box = form.getCheckBox(name);
    if (checked) box.check();
    else box.uncheck();
  } catch (err) {
    warnings.push(`check:${name}: ${err.message}`);
    console.warn(`[wh347FormFill] Could not set checkbox "${name}": ${err.message}`);
  }
}

function fillHeader(ctx, { project, company, weekEndingDate, payrollNumber, isPrime, isFinal }) {
  const h = wh347FieldMap.header;
  setText(ctx, h.projectName, project?.name, { maxFontSize: 8 });
  setText(ctx, h.projectNo, project?.contract_number || project?.projectNo);
  setText(ctx, h.certifiedPayrollNo, payrollNumber);
  setText(ctx, h.primeContractorName, company?.company_name, { maxFontSize: 8 });
  setText(ctx, h.primeContractorAddress, company?.company_address, { maxFontSize: 7 });
  setText(ctx, h.projectLocation, project?.address || project?.location, { maxFontSize: 7 });
  setText(ctx, h.wageDeterminationNo, project?.wage_determination_no);
  setText(ctx, h.weekEndingDate, weekEndingDate);

  const prime = isPrime !== false;
  setCheck(ctx.form, h.primeCheckbox, prime, ctx.warnings);
  setCheck(ctx.form, h.subCheckbox, !prime, ctx.warnings);
  setCheck(ctx.form, h.finalCheckbox, Boolean(isFinal), ctx.warnings);
}

function fillDayHeaders(ctx, weekEndingDate) {
  const weekDays = buildWeekDays(weekEndingDate);
  if (weekDays.length !== 7) return;

  // Day header widgets are ~11–13pt wide — allow smaller type than name columns.
  const tight = { maxFontSize: 5, minFontSize: 2.5, padding: 0.5 };
  const { dayLabels, dateOfWork } = wh347FieldMap.dayHeaders;
  for (let i = 0; i < 7; i += 1) {
    setText(ctx, dayLabels[i], weekDays[i].label, tight);
    setText(ctx, dateOfWork[i], formatShortDate(weekDays[i].date), tight);
  }
}

function fillWorkerSlot(ctx, slot, worker, entryNumber, supplementsByWorker, weekDays) {
  const fields = wh347FieldMap.workerRows[slot];
  if (!fields || !worker) return;

  const supplement = getSupplement(supplementsByWorker, worker.id);
  const days = worker.days || {};

  // ~11pt ST/OT day cells need a lower floor than name columns (default min 4).
  const dayHours = { maxFontSize: 6, minFontSize: 2.5, padding: 0.5 };
  const narrowMoney = { maxFontSize: 6, minFontSize: 3.5, padding: 0.75 };
  const nameOpts = { maxFontSize: 7, minFontSize: 4, padding: 1 };

  setText(ctx, fields.entryNo, entryNumber, narrowMoney);
  setText(ctx, fields.lastName, worker.last_name, nameOpts);
  setText(ctx, fields.firstName, worker.first_name, nameOpts);
  setText(ctx, fields.middleInitial, worker.middle_initial || worker.middleInitial, {
    maxFontSize: 6,
    minFontSize: 4,
  });
  setText(
    ctx,
    fields.identifyingNo,
    supplement.paychex_worker_number || worker.identifying_number,
    narrowMoney
  );
  setText(ctx, fields.workerType, worker.worker_type || 'J', {
    maxFontSize: 6,
    minFontSize: 4,
  });
  // Classifications are the most common overflow case (replaces old length>20 → size 6 heuristic).
  setText(ctx, fields.classification, worker.labor_classification, {
    maxFontSize: 7,
    minFontSize: 4,
    padding: 1,
  });

  let totalSt = 0;
  let totalOt = 0;
  for (let d = 0; d < 7; d += 1) {
    const key = weekDays[d]?.key;
    const day = (key && days[key]) || { st: 0, ot: 0 };
    const st = Number(day.st) || 0;
    const ot = Number(day.ot) || 0;
    totalSt += st;
    totalOt += ot;
    setText(ctx, fields.stHours[d], st ? moneyOrHours(st) : '', dayHours);
    setText(ctx, fields.otHours[d], ot ? moneyOrHours(ot) : '', dayHours);
  }

  const stRate = Number(worker.pay_rate) || 0;
  const otRate =
    worker.ot_pay_rate != null && worker.ot_pay_rate !== ''
      ? Number(worker.ot_pay_rate)
      : stRate * 1.5;
  const grossThisJob = totalSt * stRate + totalOt * otRate;
  const withholding = Number(supplement.deduction_withholding || 0);
  const fica = Number(supplement.deduction_fica || 0);
  const other = Number(supplement.deduction_other || 0);
  const totalDeductions = withholding + fica + other;

  setText(ctx, fields.stRate, stRate ? moneyOrHours(stRate) : '', narrowMoney);
  setText(ctx, fields.otRate, otRate ? moneyOrHours(otRate) : '', narrowMoney);
  setText(ctx, fields.totalHours, moneyOrHours(totalSt + totalOt), narrowMoney);
  setText(ctx, fields.fringeCredit, supplement.fringe_benefit_credit, narrowMoney);
  setText(ctx, fields.fringeInLieu, supplement.fringe_paid_in_lieu, narrowMoney);
  setText(ctx, fields.grossAmt, moneyOrHours(grossThisJob), narrowMoney);
  setText(ctx, fields.grossAllWork, supplement.gross_earned_all_work, narrowMoney);
  setText(ctx, fields.taxWithholding, supplement.deduction_withholding, narrowMoney);
  setText(ctx, fields.fica, supplement.deduction_fica, narrowMoney);
  // Prefer numeric other deduction; if only a label is present, fit the descriptive text.
  setText(
    ctx,
    fields.otherDeductions,
    supplement.deduction_other != null && supplement.deduction_other !== ''
      ? supplement.deduction_other
      : supplement.deduction_other_label,
    narrowMoney
  );
  setText(ctx, fields.totalDeductions, moneyOrHours(totalDeductions), narrowMoney);
  setText(ctx, fields.netPay, supplement.net_pay, narrowMoney);
}

function fillStatement(ctx, { company, weekEndingDate, statementCheckBoxes }) {
  const s = wh347FieldMap.statementPage;
  const nameTitle = [
    company?.certifying_official_name || '',
    company?.certifying_official_title || '',
  ]
    .join(' ')
    .trim();

  setText(ctx, s.additionalRemarks, company?.additional_remarks, { maxFontSize: 8 });
  setText(ctx, s.certifyingOfficialRow1, nameTitle, { maxFontSize: 8 });
  setText(ctx, s.signatureRow1, company?.certifying_official_name, { maxFontSize: 8 });
  setText(ctx, s.dateRow1, weekEndingDate);
  setText(ctx, s.email, company?.email, { maxFontSize: 7 });

  const phone = splitPhone(company?.phone);
  setText(ctx, s.areaCode, phone.areaCode, { maxFontSize: 7, minFontSize: 5 });
  setText(ctx, s.telPart1, phone.telPart1, { maxFontSize: 7, minFontSize: 5 });
  setText(ctx, s.telPart2, phone.telPart2, { maxFontSize: 7, minFontSize: 5 });

  const checked = new Set(
    Array.isArray(statementCheckBoxes) ? statementCheckBoxes.map(Number) : []
  );
  s.checkBoxes.forEach((name, idx) => {
    setCheck(ctx.form, name, checked.has(idx + 1), ctx.warnings);
  });
}

async function loadTemplate() {
  if (!fs.existsSync(TEMPLATE_PATH)) {
    throw new Error(`WH-347 fillable template not found: ${TEMPLATE_PATH}`);
  }
  const bytes = fs.readFileSync(TEMPLATE_PATH);
  return PDFDocument.load(bytes, { ignoreEncryption: true });
}

/**
 * Fill one template copy for a batch of up to 8 workers.
 * @returns {{ bytes: Uint8Array, warnings: string[] }}
 */
async function fillSingleSheet(options) {
  const {
    project,
    company,
    weekEndingDate,
    payrollNumber,
    workers = [],
    supplementsByWorker,
    flatten = false,
    isPrime = true,
    isFinal = false,
    statementCheckBoxes = [],
    includeStatement = true,
    entryNumberOffset = 0,
  } = options;

  const warnings = [];
  const pdfDoc = await loadTemplate();
  const form = pdfDoc.getForm();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const weekDays = buildWeekDays(weekEndingDate);
  const ctx = { form, pdfDoc, font, warnings };

  fillHeader(ctx, { project, company, weekEndingDate, payrollNumber, isPrime, isFinal });
  fillDayHeaders(ctx, weekEndingDate);

  const batch = workers.slice(0, WORKERS_PER_PAGE);
  batch.forEach((worker, idx) => {
    fillWorkerSlot(
      ctx,
      idx,
      worker,
      entryNumberOffset + idx + 1,
      supplementsByWorker,
      weekDays
    );
  });

  if (includeStatement) {
    fillStatement(ctx, { company, weekEndingDate, statementCheckBoxes });
  }

  // Bake appearances with the same Helvetica metrics used for shrink-to-fit,
  // so flatten and unflattened viewers agree on sizing.
  try {
    form.updateFieldAppearances(font);
  } catch (err) {
    warnings.push(`appearances: ${err.message}`);
    console.warn(`[wh347FormFill] updateFieldAppearances failed: ${err.message}`);
  }

  if (flatten) {
    try {
      form.flatten();
    } catch (err) {
      warnings.push(`flatten: ${err.message}`);
      console.warn(`[wh347FormFill] flatten failed: ${err.message}`);
    }
  }

  const bytes = await pdfDoc.save();
  return { bytes, warnings, pdfDoc };
}

/**
 * Fill WH-347 AcroForm fields.
 *
 * @param {object} params
 * @param {boolean} [params.flatten=false]
 * @returns {Promise<Buffer>}
 */
async function fillWh347Form(params) {
  const workers = Array.isArray(params.workers) ? params.workers : [];
  const pageCount = Math.max(1, Math.ceil(workers.length / WORKERS_PER_PAGE) || 1);
  const allWarnings = [];

  if (pageCount === 1) {
    const { bytes, warnings } = await fillSingleSheet({
      ...params,
      workers,
      includeStatement: true,
      entryNumberOffset: 0,
    });
    if (warnings.length) {
      console.warn(`[wh347FormFill] ${warnings.length} field warning(s)`);
    }
    return Buffer.from(bytes);
  }

  const outDoc = await PDFDocument.create();

  for (let i = 0; i < pageCount; i += 1) {
    const batch = workers.slice(i * WORKERS_PER_PAGE, i * WORKERS_PER_PAGE + WORKERS_PER_PAGE);
    const { bytes, warnings } = await fillSingleSheet({
      ...params,
      workers: batch,
      includeStatement: i === 0,
      entryNumberOffset: i * WORKERS_PER_PAGE,
    });
    allWarnings.push(...warnings);

    const sheetDoc = await PDFDocument.load(bytes);
    const [payrollPage] = await outDoc.copyPages(sheetDoc, [0]);
    outDoc.addPage(payrollPage);

    if (i === 0 && sheetDoc.getPageCount() > 1) {
      const [statementPage] = await outDoc.copyPages(sheetDoc, [1]);
      outDoc.addPage(statementPage);
    }
  }

  if (allWarnings.length) {
    console.warn(`[wh347FormFill] ${allWarnings.length} field warning(s) across ${pageCount} sheet(s)`);
  }

  const merged = await outDoc.save();
  return Buffer.from(merged);
}

module.exports = {
  fillWh347Form,
  fitTextToField,
  TEMPLATE_PATH,
  WORKERS_PER_PAGE,
  buildWeekDays,
};
