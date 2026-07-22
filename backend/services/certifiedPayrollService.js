const { query } = require('../db');
const { fetchPaychexPayPeriods } = require('./paychexPayPeriods');
const {
  getCompanyChecksForHistory,
  indexChecksByWorker,
  parseCheckForSupplement,
  parsePayPeriodId,
  clearCompanyChecksCache,
} = require('./paychexCompanyChecks');
const {
  indexChecksByWorkerDetailed,
  mapPaychexCheckToSupplementFields,
  buildReconciliationWarnings,
} = require('./certifiedPayrollComposer');
const { getPayComponentNameMap } = require('./paychexPayComponents');
const { estimateDeductions, roundMoney } = require('./payrollTaxEstimate');
const {
  selectJobSiteById,
  selectJobSiteWageDetermination,
} = require('../db/jobSiteQuery');
const { companyId: envCompanyId } = require('../config/paychexApi');
const { isPaychexPayPeriodId } = require('./paychexIds');

function getWeekWindow(weekEndingDate) {
  const day = String(weekEndingDate || '').split('T')[0];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    const error = new Error('weekEndingDate must be a valid YYYY-MM-DD date');
    error.statusCode = 400;
    throw error;
  }

  const end = new Date(`${day}T12:00:00.000Z`);
  if (Number.isNaN(end.getTime())) {
    const error = new Error('weekEndingDate must be a valid YYYY-MM-DD date');
    error.statusCode = 400;
    throw error;
  }

  const start = new Date(end);
  start.setUTCDate(end.getUTCDate() - 6);
  return {
    weekStart: start.toISOString().slice(0, 10),
    weekEnd: end.toISOString().slice(0, 10),
  };
}

function addUtcDays(dateStr, days) {
  const date = new Date(`${dateStr}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatUtcRange(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  const startLabel = start.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
  const endLabel = end.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return `${startLabel} – ${endLabel}`;
}

function formatUtcEnding(dateStr) {
  const date = new Date(`${dateStr}T00:00:00.000Z`);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

async function loadHoursRowsForDateRange(jobSiteId, startDate, endDate) {
  const result = await query(
    `SELECT
       w.id,
       w.first_name,
       w.last_name,
       w.employee_code AS identifying_number,
       w.paychex_worker_id,
       w.worker_type,
       COALESCE(w.standard_rate, 0) AS pay_rate,
       lc.name AS labor_classification,
       d.id AS entry_id,
       d.date_worked::text AS entry_date,
       d.pay_code AS paychex_component_id,
       SUM(d.hours_worked) AS hours
     FROM daily_time_entries d
     JOIN workers w ON d.worker_id = w.id
     LEFT JOIN labor_classifications lc ON w.labor_classification_id = lc.id
     WHERE d.job_site_id = $1
       AND d.date_worked BETWEEN $2 AND $3
       AND d.pay_code IN ('REGULAR','HOURLY','Hourly','Regular','OT','OVERTIME','Overtime','DT','DOUBLETIME')
     GROUP BY
       w.id, w.first_name, w.last_name,
       w.employee_code, w.paychex_worker_id, w.worker_type, w.standard_rate,
       lc.name, d.id, d.date_worked, d.pay_code
     ORDER BY w.last_name, d.date_worked`,
    [jobSiteId, startDate, endDate]
  );
  return result.rows;
}

async function loadHoursRows(jobSiteId, weekEndingDate) {
  const { weekStart, weekEnd } = getWeekWindow(weekEndingDate);
  return loadHoursRowsForDateRange(jobSiteId, weekStart, weekEnd);
}

function calculateBiweeklyGrossThisJob(payPeriodHoursRows, workerId, rate) {
  // TODO: aggregate gross across all job sites once multi-site workers are verified.
  const workerEntries = payPeriodHoursRows.filter((row) => row.id === workerId);
  return calculateGrossThisJob(workerEntries, rate);
}

function logSupplementEstimateDebug({
  worker,
  weekStart,
  weekEnd,
  payPeriodStart,
  payPeriodEnd,
  grossThisJob,
  grossAllWork,
  fica,
  federalWithholding,
  netPay,
}) {
  if (process.env.CERTIFIED_PAYROLL_DEBUG !== '1') return;

  console.debug(
    '[certified-payroll/estimate]',
    JSON.stringify({
      worker: worker.workerName,
      weekStart,
      weekEnd,
      payPeriodStart,
      payPeriodEnd,
      grossThisJob: roundMoney(grossThisJob).toFixed(2),
      grossAllWork: roundMoney(grossAllWork).toFixed(2),
      fica: roundMoney(fica).toFixed(2),
      federalWithholding: roundMoney(federalWithholding).toFixed(2),
      netPay: roundMoney(netPay).toFixed(2),
    })
  );
}

function mergeBiweeklySupplementFields(primary, fallback = {}) {
  return {
    ...primary,
    paychex_worker_number: primary.paychex_worker_number ?? fallback.paychex_worker_number,
    wage_determination_no: primary.wage_determination_no ?? fallback.wage_determination_no,
    fringe_benefit_credit: primary.fringe_benefit_credit ?? fallback.fringe_benefit_credit,
    fringe_paid_in_lieu: primary.fringe_paid_in_lieu ?? fallback.fringe_paid_in_lieu,
    gross_earned_all_work: primary.gross_earned_all_work ?? fallback.gross_earned_all_work,
    deduction_withholding: primary.deduction_withholding ?? fallback.deduction_withholding,
    deduction_fica: primary.deduction_fica ?? fallback.deduction_fica,
    deduction_other: primary.deduction_other ?? fallback.deduction_other,
    deduction_other_label: primary.deduction_other_label ?? fallback.deduction_other_label,
    net_pay: primary.net_pay ?? fallback.net_pay,
  };
}

function calculateGrossThisJob(entries, rate) {
  const hourlyRate = Number(rate) || 0;
  let totalSt = 0;
  let totalOt = 0;
  for (const entry of entries) {
    const hours = Number(entry.hours) || 0;
    if (['OT', 'OVERTIME', 'Overtime'].includes(entry.paychex_component_id)) {
      totalOt += hours;
    } else {
      totalSt += hours;
    }
  }
  return roundMoney(totalSt * hourlyRate + totalOt * hourlyRate * 1.5);
}

function groupWorkersFromHours(hoursRows) {
  const map = new Map();
  for (const row of hoursRows) {
    if (!map.has(row.id)) {
      map.set(row.id, {
        workerId: row.id,
        paychexWorkerId: row.paychex_worker_id,
        workerName: `${row.first_name || ''} ${row.last_name || ''}`.trim(),
        paychexWorkerNumber: row.identifying_number || '',
        rate: Number(row.pay_rate) || 0,
        laborClassification: row.labor_classification || '',
        entries: [],
      });
    }
    map.get(row.id).entries.push(row);
  }
  return [...map.values()];
}

function mergeOtherDeductions(otherDeductions) {
  if (!otherDeductions?.length) {
    return { amount: 0, label: '' };
  }
  const amount = roundMoney(otherDeductions.reduce((sum, item) => sum + Number(item.amount || 0), 0));
  const label = otherDeductions.map((item) => item.label).filter(Boolean).join(', ');
  return { amount, label };
}

function formatMoneyField(value) {
  if (value == null || value === '') return null;
  return roundMoney(value);
}

function buildSupplementFromPaychex({ checkData, site, worker, mapped = null }) {
  const other = mapped
    ? { amount: mapped.otherAmount, label: mapped.otherLabel }
    : mergeOtherDeductions(checkData.otherDeductions);
  return {
    worker_id: worker.workerId,
    worker_name: worker.workerName,
    paychex_worker_number: worker.paychexWorkerNumber,
    wage_determination_no: site?.wage_determination_no || '',
    fringe_benefit_credit: 0,
    fringe_paid_in_lieu: 0,
    gross_earned_all_work: mapped?.grossAllWork ?? checkData.grossPay,
    deduction_withholding: mapped?.withholding ?? checkData.federalWithholding,
    deduction_fica: mapped?.fica ?? checkData.fica,
    deduction_other: other.amount,
    deduction_other_label: other.label,
    net_pay: mapped?.netPay ?? checkData.netPay,
    is_estimated: false,
    source: 'paychex',
    paycheck_id: mapped?.paycheckId || null,
    paychex_check_worker_id: mapped?.workerId || null,
    total_deductions: mapped?.totalDeductions ?? null,
  };
}

function buildSupplementEstimate({ grossAllWork, site, worker }) {
  const estimate = estimateDeductions(grossAllWork);
  const other = mergeOtherDeductions(estimate.otherDeductions);
  return {
    worker_id: worker.workerId,
    worker_name: worker.workerName,
    paychex_worker_number: worker.paychexWorkerNumber,
    wage_determination_no: site?.wage_determination_no || '',
    fringe_benefit_credit: 0,
    fringe_paid_in_lieu: 0,
    gross_earned_all_work: estimate.grossPay,
    // Federal withholding / net require Paychex checks or manual entry — leave blank.
    deduction_withholding: null,
    deduction_fica: estimate.fica,
    deduction_other: other.amount,
    deduction_other_label: other.label,
    net_pay: null,
    is_estimated: false,
    needs_manual_withholding: true,
    source: 'hours',
  };
}

async function upsertSupplementRow({ workerId, jobSiteId, weekEndingDate, row }) {
  const result = await query(
    `INSERT INTO wh347_supplements (
       worker_id, job_site_id, week_ending_date, paychex_worker_number,
       wage_determination_no,
       fringe_benefit_credit, fringe_paid_in_lieu, gross_earned_all_work,
       deduction_withholding, deduction_fica, deduction_other,
       deduction_other_label, net_pay
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (worker_id, job_site_id, week_ending_date) DO UPDATE SET
       paychex_worker_number = EXCLUDED.paychex_worker_number,
       wage_determination_no = EXCLUDED.wage_determination_no,
       fringe_benefit_credit = EXCLUDED.fringe_benefit_credit,
       fringe_paid_in_lieu = EXCLUDED.fringe_paid_in_lieu,
       gross_earned_all_work = EXCLUDED.gross_earned_all_work,
       deduction_withholding = EXCLUDED.deduction_withholding,
       deduction_fica = EXCLUDED.deduction_fica,
       deduction_other = EXCLUDED.deduction_other,
       deduction_other_label = EXCLUDED.deduction_other_label,
       net_pay = EXCLUDED.net_pay
     RETURNING *`,
    [
      workerId,
      jobSiteId,
      weekEndingDate,
      row.paychex_worker_number || null,
      row.wage_determination_no || null,
      formatMoneyField(row.fringe_benefit_credit),
      formatMoneyField(row.fringe_paid_in_lieu),
      formatMoneyField(row.gross_earned_all_work),
      formatMoneyField(row.deduction_withholding),
      formatMoneyField(row.deduction_fica),
      formatMoneyField(row.deduction_other),
      row.deduction_other_label || null,
      formatMoneyField(row.net_pay),
    ]
  );
  return result.rows[0];
}

async function upsertBiweeklySupplementRows({
  workerId,
  jobSiteId,
  weekEndingDates,
  selectedWeekEndingDate,
  row,
}) {
  const uniqueDates = [...new Set(weekEndingDates.filter(Boolean))];
  const savedRows = [];

  for (const weekEndingDate of uniqueDates) {
    const saved = await upsertSupplementRow({
      workerId,
      jobSiteId,
      weekEndingDate,
      row,
    });
    savedRows.push(saved);
  }

  const selectedDate = String(selectedWeekEndingDate || '').split('T')[0];
  return (
    savedRows.find(
      (saved) => String(saved.week_ending_date).split('T')[0] === selectedDate
    ) ||
    savedRows[0] ||
    null
  );
}

function formatSupplementResponse(row) {
  const withholdingBlank =
    row.deduction_withholding == null || row.deduction_withholding === '';
  const needsManualWithholding =
    Boolean(row.needs_manual_withholding) || withholdingBlank;

  return {
    worker_id: row.worker_id,
    worker_name: row.worker_name,
    paychex_worker_number: row.paychex_worker_number,
    classification: row.classification || row.labor_classification || '',
    week_ending_date: row.week_ending_date,
    wage_determination_no: row.wage_determination_no ?? '',
    fringe_benefit_credit:
      row.fringe_benefit_credit != null ? roundMoney(row.fringe_benefit_credit).toFixed(2) : '0.00',
    fringe_paid_in_lieu:
      row.fringe_paid_in_lieu != null ? roundMoney(row.fringe_paid_in_lieu).toFixed(2) : '0.00',
    gross_earned_all_work:
      row.gross_earned_all_work != null ? roundMoney(row.gross_earned_all_work).toFixed(2) : '',
    deduction_withholding:
      row.deduction_withholding != null && row.deduction_withholding !== ''
        ? roundMoney(row.deduction_withholding).toFixed(2)
        : '',
    deduction_fica: row.deduction_fica != null ? roundMoney(row.deduction_fica).toFixed(2) : '',
    deduction_other: row.deduction_other != null ? roundMoney(row.deduction_other).toFixed(2) : '',
    deduction_other_label: row.deduction_other_label ?? '',
    net_pay:
      row.net_pay != null && row.net_pay !== '' ? roundMoney(row.net_pay).toFixed(2) : '',
    isEstimated: false,
    needsManualWithholding,
    source: row.source || (row.is_estimated ? 'estimated' : 'saved'),
    paycheckId: row.paycheck_id || row.paycheckId || null,
    paychexCheckWorkerId: row.paychex_check_worker_id || null,
    totalDeductions:
      row.total_deductions != null
        ? roundMoney(row.total_deductions).toFixed(2)
        : row.totalDeductions != null
          ? roundMoney(row.totalDeductions).toFixed(2)
          : null,
  };
}

function mapPayPeriodRowToOption(period) {
  const startDate = period.start_date || period.startDate;
  const endDate = period.end_date || period.endDate;
  const week1Start = period.week1_start || period.week1Start || startDate;
  const week1End = period.week1_end || period.week1End || addUtcDays(startDate, 6);
  const week2Start = period.week2_start || period.week2Start || addUtcDays(startDate, 7);
  const week2End = period.week2_end || period.week2End || endDate;

  return {
    payPeriodId: period.paychex_period_id || period.payPeriodId,
    startDate,
    endDate,
    week1Start,
    week1End,
    week2Start,
    week2End,
    label: formatUtcRange(startDate, endDate),
    week1Label: `Week 1: ${formatUtcRange(week1Start, week1End)} (ending ${formatUtcEnding(week1End)})`,
    week2Label: `Week 2: ${formatUtcRange(week2Start, week2End)} (ending ${formatUtcEnding(week2End)})`,
  };
}

async function getClosedPayPeriods() {
  try {
    const periods = await fetchPaychexPayPeriods();
    if (periods.length > 0) {
      return periods;
    }
    console.warn('[PayPeriods] No pay periods available from shared payroll list');
  } catch (error) {
    console.error('[PayPeriods] Pay period fetch failed:', error.message);
  }

  return [];
}

async function resolvePayPeriodWeekEnds(payPeriodId) {
  const parsed = parsePayPeriodId(payPeriodId);
  if (parsed) {
    return {
      startDate: parsed.startDate,
      endDate: parsed.endDate,
      week1End: parsed.week1End,
      week2End: parsed.week2End,
      weekEndingDates: [...new Set([parsed.week1End, parsed.week2End])],
      approximate: Boolean(parsed.approximate),
      paychexPeriodId: null,
    };
  }

  const result = await query(
    `SELECT
       start_date::text AS start_date,
       end_date::text AS end_date,
       week1_end::text AS week1_end,
       week2_end::text AS week2_end,
       paychex_period_id
     FROM pay_periods
     WHERE id::text = $1
        OR paychex_period_id = $1`,
    [payPeriodId]
  );

  if (!result.rows.length) {
    // Fall back to synced Paychex catalog (COMPLETED historical periods).
    const catalog = await query(
      `SELECT
         pay_period_id,
         start_date::text AS start_date,
         end_date::text AS end_date
       FROM paychex_pay_periods
       WHERE pay_period_id = $1
       LIMIT 1`,
      [payPeriodId]
    );

    if (!catalog.rows.length) return null;

    const catalogPeriod = catalog.rows[0];
    const startDate = catalogPeriod.start_date;
    const endDate = catalogPeriod.end_date;
    const week1End = addUtcDays(startDate, 6);
    const week2End = endDate;

    return {
      startDate,
      endDate,
      week1End,
      week2End,
      weekEndingDates: [...new Set([week1End, week2End])],
      approximate: false,
      paychexPeriodId: String(catalogPeriod.pay_period_id),
    };
  }

  const period = result.rows[0];
  const startDate = period.start_date;
  const endDate = period.end_date;
  const week1End = period.week1_end || addUtcDays(startDate, 6);
  const week2End = period.week2_end || endDate;

  let paychexPeriodId = period.paychex_period_id || null;
  try {
    const { findPaychexPayPeriodForDates } = require('./paychexPayPeriodReconcile');
    const { companyId } = require('../config/paychexApi');
    const catalogMatch = await findPaychexPayPeriodForDates({
      companyId: companyId(),
      startDate,
      endDate,
    });
    if (catalogMatch?.pay_period_id) {
      paychexPeriodId = String(catalogMatch.pay_period_id);
    }
  } catch (error) {
    console.warn('[PayPeriods] Catalog lookup failed:', error.message);
  }

  return {
    startDate,
    endDate,
    week1End,
    week2End,
    weekEndingDates: [...new Set([week1End, week2End])],
    approximate: false,
    paychexPeriodId,
  };
}

async function resolvePayPeriodContext(payPeriodId, { week1End, week2End } = {}) {
  const resolved = await resolvePayPeriodWeekEnds(payPeriodId);
  if (!resolved?.startDate || !resolved?.endDate) return null;

  const week1 = week1End || resolved.week1End;
  const week2 = week2End || resolved.week2End;

  return {
    payPeriodStart: resolved.startDate,
    payPeriodEnd: resolved.endDate,
    week1End: week1,
    week2End: week2,
    weekEndingDates: [...new Set([week1, week2])],
    approximate: Boolean(resolved.approximate),
    paychexPeriodId: resolved.paychexPeriodId || null,
  };
}

async function clearSupplementCache({ jobSiteId, weekEndingDates }) {
  if (!weekEndingDates.length) return 0;
  clearCompanyChecksCache();
  const result = await query(
    `DELETE FROM wh347_supplements
     WHERE job_site_id = $1
       AND week_ending_date = ANY($2::date[])`,
    [jobSiteId, weekEndingDates]
  );
  return result.rowCount;
}

/**
 * Compose Certified Payroll supplement rows:
 * hours stay on daily_time_entries; money fields prefer Paychex company checks.
 */
async function getCertifiedPayrollData({
  companyId = envCompanyId(),
  jobSiteId,
  localPayPeriodId,
  payPeriodId,
  weekEndingDate,
  selectedWeek,
  paychexPayPeriodId = null,
  payPeriodStart,
  payPeriodEnd,
  week1End,
  week2End,
  forceRefresh = false,
} = {}) {
  const localId = localPayPeriodId || payPeriodId;
  return buildSupplementRows({
    jobSiteId,
    weekEndingDate,
    payPeriodId: localId,
    paychexPayPeriodId,
    payPeriodStart,
    payPeriodEnd,
    week1End,
    week2End,
    forceRefresh,
    companyId,
    selectedWeek,
  });
}

async function buildSupplementRows({
  jobSiteId,
  weekEndingDate,
  payPeriodId,
  paychexPayPeriodId = null,
  payPeriodStart,
  payPeriodEnd,
  week1End,
  week2End,
  forceRefresh = false,
  companyId = envCompanyId(),
  selectedWeek = null,
}) {
  let periodWeeks = await resolvePayPeriodContext(payPeriodId, { week1End, week2End });

  if (!periodWeeks && payPeriodStart && payPeriodEnd) {
    const week1 = week1End || addUtcDays(payPeriodStart, 6);
    const week2 = week2End || payPeriodEnd;
    periodWeeks = {
      payPeriodStart,
      payPeriodEnd,
      week1End: week1,
      week2End: week2,
      weekEndingDates: [...new Set([week1, week2])],
      approximate: false,
      paychexPeriodId: null,
    };
  }

  if (!periodWeeks?.payPeriodStart || !periodWeeks?.payPeriodEnd) {
    const error = new Error('Pay period not found or missing start/end dates');
    error.statusCode = 404;
    throw error;
  }

  const resolvedPaychexPayPeriodId = isPaychexPayPeriodId(paychexPayPeriodId)
    ? String(paychexPayPeriodId).trim()
    : periodWeeks.paychexPeriodId || null;

  const { weekStart, weekEnd } = getWeekWindow(weekEndingDate);

  // Hours always from internal daily_time_entries (selected week + full period for estimates).
  const [hoursRows, payPeriodHoursRows, site, existingResult] = await Promise.all([
    loadHoursRows(jobSiteId, weekEndingDate),
    loadHoursRowsForDateRange(
      jobSiteId,
      periodWeeks.payPeriodStart,
      periodWeeks.payPeriodEnd
    ),
    selectJobSiteById(jobSiteId),
    query(
      `SELECT ws.*, TRIM(w.first_name || ' ' || w.last_name) AS worker_name,
              lc.name AS labor_classification
       FROM wh347_supplements ws
       JOIN workers w ON w.id = ws.worker_id
       LEFT JOIN labor_classifications lc ON w.labor_classification_id = lc.id
       WHERE ws.job_site_id = $1 AND ws.week_ending_date = $2`,
      [jobSiteId, weekEndingDate]
    ),
  ]);

  if (!site) {
    const error = new Error('Job site not found');
    error.statusCode = 404;
    throw error;
  }

  const workers = groupWorkersFromHours(hoursRows);
  const existingByWorker = new Map(existingResult.rows.map((row) => [row.worker_id, row]));
  const rows = [];
  let hasEstimated = false;
  let needsManualWithholding = false;
  const debugWorkers = [];

  const checksPayPeriodId = resolvedPaychexPayPeriodId || payPeriodId;
  const [allChecks, componentMap] = await Promise.all([
    getCompanyChecksForHistory({ forceRefresh, payPeriodId: checksPayPeriodId }),
    getPayComponentNameMap(),
  ]);
  const {
    checksByWorker,
    workersWithMultipleChecksInSamePayPeriod,
  } = indexChecksByWorkerDetailed(allChecks);

  for (const worker of workers) {
    const existing = existingByWorker.get(worker.workerId);
    let mapped = null;

    if (worker.paychexWorkerId) {
      const rawCheck = checksByWorker[String(worker.paychexWorkerId)] || null;
      if (rawCheck) {
        mapped = mapPaychexCheckToSupplementFields(rawCheck, componentMap);
      }
    }

    // Money: prefer Paychex check when present. Hours stay on daily_time_entries only.
    if (mapped) {
      const supplementRow = buildSupplementFromPaychex({
        checkData: mapped.parsed,
        site,
        worker,
        mapped,
      });

      const saved = await upsertBiweeklySupplementRows({
        workerId: worker.workerId,
        jobSiteId,
        weekEndingDates: periodWeeks.weekEndingDates,
        selectedWeekEndingDate: weekEndingDate,
        row: supplementRow,
      });

      const formatted = formatSupplementResponse({
        ...saved,
        worker_name: worker.workerName,
        classification: worker.laborClassification,
        source: 'paychex',
        paycheck_id: supplementRow.paycheck_id,
        paychex_check_worker_id: supplementRow.paychex_check_worker_id,
        total_deductions: supplementRow.total_deductions,
      });
      rows.push(formatted);
      debugWorkers.push({
        workerId: worker.workerId,
        workerName: worker.workerName,
        paychexWorkerId: worker.paychexWorkerId || null,
        paycheckId: mapped.paycheckId,
        source: 'paychex',
        gross: mapped.grossAllWork,
        withholding: mapped.withholding,
        fica: mapped.fica,
        netPay: mapped.netPay,
      });
      continue;
    }

    if (existing && !forceRefresh) {
      const formatted = formatSupplementResponse({
        ...existing,
        worker_name: existing.worker_name || worker.workerName,
        classification: worker.laborClassification,
        source: 'saved',
      });
      if (formatted.needsManualWithholding) needsManualWithholding = true;
      rows.push(formatted);
      debugWorkers.push({
        workerId: worker.workerId,
        workerName: worker.workerName,
        paychexWorkerId: worker.paychexWorkerId || null,
        paycheckId: null,
        source: 'saved',
      });
      continue;
    }

    const grossThisJob = calculateGrossThisJob(worker.entries, worker.rate);
    const grossAllWork = calculateBiweeklyGrossThisJob(
      payPeriodHoursRows,
      worker.workerId,
      worker.rate
    );
    const estimate = estimateDeductions(grossAllWork);

    logSupplementEstimateDebug({
      worker,
      weekStart,
      weekEnd,
      payPeriodStart: periodWeeks.payPeriodStart,
      payPeriodEnd: periodWeeks.payPeriodEnd,
      grossThisJob,
      grossAllWork,
      fica: estimate.fica,
      federalWithholding: estimate.federalWithholding,
      netPay: estimate.netPay,
    });

    const supplementRow = buildSupplementEstimate({ grossAllWork, site, worker });
    needsManualWithholding = true;
    hasEstimated = true;

    const saved = await upsertBiweeklySupplementRows({
      workerId: worker.workerId,
      jobSiteId,
      weekEndingDates: periodWeeks.weekEndingDates,
      selectedWeekEndingDate: weekEndingDate,
      row: supplementRow,
    });

    const formatted = formatSupplementResponse({
      ...saved,
      worker_name: worker.workerName,
      classification: worker.laborClassification,
      source: supplementRow.source,
      needs_manual_withholding: supplementRow.needs_manual_withholding,
    });
    if (formatted.needsManualWithholding) needsManualWithholding = true;
    rows.push(formatted);

    debugWorkers.push({
      workerId: worker.workerId,
      workerName: worker.workerName,
      paychexWorkerId: worker.paychexWorkerId || null,
      paycheckId: null,
      source: 'hours',
      gross: supplementRow.gross_earned_all_work,
      withholding: null,
      fica: supplementRow.deduction_fica,
      netPay: null,
    });
  }

  rows.sort((a, b) => a.worker_name.localeCompare(b.worker_name));

  const warnings = buildReconciliationWarnings({
    workers,
    checksByWorker,
    workersWithMultipleChecksInSamePayPeriod,
  });

  const debug = {
    companyId: companyId || null,
    localPayPeriodId: payPeriodId || null,
    selectedWeek: selectedWeek || null,
    weekEndingDate,
    paychexPayPeriodId: resolvedPaychexPayPeriodId,
    checksFetched: allChecks.length,
    hoursSource: 'daily_time_entries',
    moneySource: resolvedPaychexPayPeriodId ? 'paychex_company_checks' : 'none',
    workers: debugWorkers,
  };

  return {
    rows,
    hasEstimated,
    needsManualWithholding,
    warnings,
    debug,
  };
}

async function fetchAndCacheCheckData({
  payPeriodId,
  jobSiteId,
  weekEndingDate,
  week1End,
  week2End,
  workerIds,
}) {
  const periodWeeks =
    week1End && week2End
      ? { weekEndingDates: [...new Set([week1End, week2End])] }
      : await resolvePayPeriodWeekEnds(payPeriodId);

  if (!periodWeeks) {
    const error = new Error('Pay period not found');
    error.statusCode = 404;
    throw error;
  }

  const workerResult = await query(
    `SELECT id, paychex_worker_id, employee_code,
            TRIM(first_name || ' ' || last_name) AS worker_name
     FROM workers
     WHERE paychex_worker_id = ANY($1::text[])`,
    [workerIds]
  );

  const site = await selectJobSiteWageDetermination(jobSiteId);
  const componentMap = await getPayComponentNameMap();
  const allChecks = await getCompanyChecksForHistory({
    forceRefresh: true,
    payPeriodId: periodWeeks.paychexPeriodId || payPeriodId,
  });
  const checksByWorker = indexChecksByWorker(allChecks);

  const results = [];
  for (const worker of workerResult.rows) {
    const rawCheck = checksByWorker[worker.paychex_worker_id];
    const checkData = rawCheck ? parseCheckForSupplement(rawCheck, componentMap) : null;
    if (!checkData) {
      results.push({ workerId: worker.paychex_worker_id, unavailable: true });
      continue;
    }

    const supplementRow = buildSupplementFromPaychex({
      checkData,
      site,
      worker: {
        workerId: worker.id,
        workerName: worker.worker_name,
        paychexWorkerNumber: worker.employee_code,
      },
    });

    await upsertBiweeklySupplementRows({
      workerId: worker.id,
      jobSiteId,
      weekEndingDates: periodWeeks.weekEndingDates,
      selectedWeekEndingDate: weekEndingDate,
      row: supplementRow,
    });

    results.push({
      workerId: worker.paychex_worker_id,
      ...checkData,
    });
  }

  return results;
}

module.exports = {
  getWeekWindow,
  loadHoursRows,
  loadHoursRowsForDateRange,
  getClosedPayPeriods,
  resolvePayPeriodWeekEnds,
  resolvePayPeriodContext,
  buildSupplementRows,
  getCertifiedPayrollData,
  clearSupplementCache,
  fetchAndCacheCheckData,
  calculateGrossThisJob,
  calculateBiweeklyGrossThisJob,
  mergeBiweeklySupplementFields,
  buildSupplementEstimate,
  buildSupplementFromPaychex,
  groupWorkersFromHours,
  roundMoney,
};
