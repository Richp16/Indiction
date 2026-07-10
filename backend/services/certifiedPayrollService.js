const { query } = require('../db');
const { fetchWorkerCheckData } = require('./paychexCheckData');
const { fetchPaychexPayPeriods } = require('./paychexPayPeriods');
const { estimateDeductions, roundMoney } = require('./payrollTaxEstimate');
const {
  selectJobSiteById,
  selectJobSiteWageDetermination,
} = require('../db/jobSiteQuery');

function getWeekWindow(weekEndingDate) {
  const end = new Date(`${weekEndingDate}T12:00:00.000Z`);
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

function buildSupplementFromPaychex({ checkData, site, worker }) {
  const other = mergeOtherDeductions(checkData.otherDeductions);
  return {
    worker_id: worker.workerId,
    worker_name: worker.workerName,
    paychex_worker_number: worker.paychexWorkerNumber,
    wage_determination_no: site?.wage_determination_no || '',
    fringe_benefit_credit: 0,
    fringe_paid_in_lieu: 0,
    gross_earned_all_work: checkData.grossPay,
    deduction_withholding: checkData.federalWithholding,
    deduction_fica: checkData.fica,
    deduction_other: other.amount,
    deduction_other_label: other.label,
    net_pay: checkData.netPay,
    is_estimated: false,
    source: 'paychex',
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
    deduction_withholding: estimate.federalWithholding,
    deduction_fica: estimate.fica,
    deduction_other: other.amount,
    deduction_other_label: other.label,
    net_pay: estimate.netPay,
    is_estimated: true,
    source: 'estimated',
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
      row.deduction_withholding != null ? roundMoney(row.deduction_withholding).toFixed(2) : '',
    deduction_fica: row.deduction_fica != null ? roundMoney(row.deduction_fica).toFixed(2) : '',
    deduction_other: row.deduction_other != null ? roundMoney(row.deduction_other).toFixed(2) : '',
    deduction_other_label: row.deduction_other_label ?? '',
    net_pay: row.net_pay != null ? roundMoney(row.net_pay).toFixed(2) : '',
    isEstimated: row.source === 'estimated' || Boolean(row.is_estimated),
    source: row.source || (row.is_estimated ? 'estimated' : 'saved'),
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

async function getClosedPayPeriodsFromDb() {
  const today = new Date().toISOString().slice(0, 10);

  const result = await query(
    `SELECT
       paychex_period_id,
       start_date::text AS start_date,
       end_date::text AS end_date,
       week1_start::text AS week1_start,
       week1_end::text AS week1_end,
       week2_start::text AS week2_start,
       week2_end::text AS week2_end
     FROM pay_periods
     WHERE end_date::text < $1
     ORDER BY end_date DESC
     LIMIT 10`,
    [today]
  );

  return result.rows.map(mapPayPeriodRowToOption);
}

async function getClosedPayPeriods() {
  try {
    const paychexPeriods = await fetchPaychexPayPeriods();
    if (paychexPeriods.length > 0) {
      return paychexPeriods.map((period) => {
        const startDate = String(period.startDate).split('T')[0];
        const endDate = String(period.endDate).split('T')[0];
        return mapPayPeriodRowToOption({
          payPeriodId: period.payPeriodId,
          startDate,
          endDate,
        });
      });
    }
    console.warn('[PayPeriods] Paychex returned no closed periods; falling back to local DB');
  } catch (error) {
    console.error('[PayPeriods] Paychex fetch failed; falling back to local DB:', error.message);
  }

  return getClosedPayPeriodsFromDb();
}

async function resolvePayPeriodWeekEnds(payPeriodId) {
  const result = await query(
    `SELECT
       start_date::text AS start_date,
       end_date::text AS end_date,
       week1_end::text AS week1_end,
       week2_end::text AS week2_end
     FROM pay_periods
     WHERE paychex_period_id = $1`,
    [payPeriodId]
  );

  if (!result.rows.length) return null;

  const period = result.rows[0];
  const startDate = period.start_date;
  const endDate = period.end_date;
  const week1End = period.week1_end || addUtcDays(startDate, 6);
  const week2End = period.week2_end || endDate;

  return {
    startDate,
    endDate,
    week1End,
    week2End,
    weekEndingDates: [...new Set([week1End, week2End])],
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
  };
}

async function clearSupplementCache({ jobSiteId, weekEndingDates }) {
  if (!weekEndingDates.length) return 0;
  const result = await query(
    `DELETE FROM wh347_supplements
     WHERE job_site_id = $1
       AND week_ending_date = ANY($2::date[])`,
    [jobSiteId, weekEndingDates]
  );
  return result.rowCount;
}

async function buildSupplementRows({
  jobSiteId,
  weekEndingDate,
  payPeriodId,
  payPeriodStart,
  payPeriodEnd,
  week1End,
  week2End,
  forceRefresh = false,
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
    };
  }

  if (!periodWeeks?.payPeriodStart || !periodWeeks?.payPeriodEnd) {
    const error = new Error('Pay period not found or missing start/end dates');
    error.statusCode = 404;
    throw error;
  }

  const { weekStart, weekEnd } = getWeekWindow(weekEndingDate);

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

  for (const worker of workers) {
    const existing = existingByWorker.get(worker.workerId);

    let checkData = null;
    if (worker.paychexWorkerId && payPeriodId) {
      checkData = await fetchWorkerCheckData(worker.paychexWorkerId, payPeriodId);
    }

    if (existing && !forceRefresh && checkData) {
      const formatted = formatSupplementResponse({
        ...existing,
        worker_name: existing.worker_name || worker.workerName,
        source: 'saved',
      });
      rows.push(formatted);
      continue;
    }

    let supplementRow;
    if (checkData) {
      supplementRow = buildSupplementFromPaychex({ checkData, site, worker });
    } else {
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

      supplementRow = buildSupplementEstimate({ grossAllWork, site, worker });
      hasEstimated = true;
    }

    const saved = await upsertBiweeklySupplementRows({
      workerId: worker.workerId,
      jobSiteId,
      weekEndingDates: periodWeeks.weekEndingDates,
      selectedWeekEndingDate: weekEndingDate,
      row: supplementRow,
    });

    rows.push(
      formatSupplementResponse({
        ...saved,
        worker_name: worker.workerName,
        classification: worker.laborClassification,
        source: supplementRow.source,
      })
    );
  }

  rows.sort((a, b) => a.worker_name.localeCompare(b.worker_name));
  return { rows, hasEstimated };
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

  const results = [];
  for (const worker of workerResult.rows) {
    const checkData = await fetchWorkerCheckData(worker.paychex_worker_id, payPeriodId);
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
  clearSupplementCache,
  fetchAndCacheCheckData,
  calculateGrossThisJob,
  calculateBiweeklyGrossThisJob,
  mergeBiweeklySupplementFields,
  buildSupplementEstimate,
  buildSupplementFromPaychex,
  roundMoney,
};
