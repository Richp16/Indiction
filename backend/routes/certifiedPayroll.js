const express = require('express');
const { query } = require('../db');
const { requireRole } = require('../middleware/roleGuard');
const {
  getWeekWindow,
  loadHoursRows,
  getClosedPayPeriods,
  buildSupplementRows,
  clearSupplementCache,
  fetchAndCacheCheckData,
  resolvePayPeriodWeekEnds,
  resolvePayPeriodContext,
  mergeBiweeklySupplementFields,
  toWh347WorkerType,
  isSupervisorClassification,
} = require('../services/certifiedPayrollService');
const { fetchChecksForWorkers } = require('../services/paychexCheckData');
const { fillWh347Form } = require('../services/wh347FormFill');
const { buildWh347PdfLegacy } = require('../services/wh347PdfLegacy');
const { requireCertifiedPayrollLock } = require('../middleware/editLock');

const router = express.Router();
router.use(requireRole('system_admin', 'payroll_admin'));

function dayKey(dateStr) {
  const date = new Date(`${dateStr}T12:00:00`);
  return ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][date.getDay()];
}

/**
 * Feature flag: USE_NEW_WH347_EXPORT (default true).
 * Set to 0/false/off to roll back to buildWh347PdfLegacy without a code change.
 */
function useNewWh347Export() {
  const raw = process.env.USE_NEW_WH347_EXPORT;
  if (raw == null || raw === '') return true;
  return !['0', 'false', 'no', 'off'].includes(String(raw).trim().toLowerCase());
}

function parseFlattenFlag(req) {
  const raw =
    req.body?.flatten ??
    req.query?.flatten ??
    req.body?.flattenPdf ??
    req.query?.flattenPdf;
  if (raw == null || raw === '') return true;
  return !['0', 'false', 'no', 'off'].includes(String(raw).trim().toLowerCase());
}

function buildWorkersFromHours(hoursRows) {
  const byWorker = new Map();
  for (const row of hoursRows) {
    // Supervisors are not covered classifications — never on WH-347.
    if (isSupervisorClassification(row.labor_classification)) continue;
    const workerId = row.id;
    if (!byWorker.has(workerId)) {
      byWorker.set(workerId, {
        id: workerId,
        first_name: row.first_name || '',
        last_name: row.last_name || '',
        worker_type: row.worker_type || 'J',
        wh347WorkerType: toWh347WorkerType(row.worker_type),
        identifying_number: row.identifying_number || '',
        labor_classification: row.labor_classification || '',
        needsClassification: !row.labor_classification,
        pay_rate: Number(row.pay_rate) || 0,
        days: {
          mon: { st: 0, ot: 0 },
          tue: { st: 0, ot: 0 },
          wed: { st: 0, ot: 0 },
          thu: { st: 0, ot: 0 },
          fri: { st: 0, ot: 0 },
          sat: { st: 0, ot: 0 },
          sun: { st: 0, ot: 0 },
        },
      });
    }
    const worker = byWorker.get(workerId);
    const key = dayKey(row.entry_date);
    const isOt = ['OT', 'OVERTIME', 'Overtime'].includes(row.paychex_component_id);
    worker.days[key][isOt ? 'ot' : 'st'] += Number(row.hours) || 0;
  }
  return [...byWorker.values()];
}

function buildSupplementsByWorker(supplementRows, weekEndingDate) {
  const supplementsByWorker = new Map();
  for (const row of supplementRows) {
    const workerId = row.worker_id;
    const existing = supplementsByWorker.get(workerId);
    if (!existing) {
      supplementsByWorker.set(workerId, row);
      continue;
    }
    const selectedDate = String(weekEndingDate).split('T')[0];
    const existingDate = String(existing.week_ending_date).split('T')[0];
    const rowDate = String(row.week_ending_date).split('T')[0];
    const primary = rowDate === selectedDate ? row : existingDate === selectedDate ? existing : row;
    const fallback = primary === row ? existing : row;
    supplementsByWorker.set(workerId, mergeBiweeklySupplementFields(primary, fallback));
  }
  return supplementsByWorker;
}

function pickWageDetermination(site, supplementsByWorker) {
  if (site?.wage_determination_no) return site.wage_determination_no;
  for (const row of supplementsByWorker.values()) {
    if (row?.wage_determination_no) return row.wage_determination_no;
  }
  return null;
}

router.get('/pay-periods', async (_req, res) => {
  try {
    const periods = await getClosedPayPeriods();
    res.json({ periods });
  } catch (error) {
    console.error('[certified-payroll/pay-periods]', error.message);
    res.status(500).json({ message: error.message });
  }
});

router.get('/hours', async (req, res) => {
  try {
    const { jobSiteId, weekEndingDate } = req.query;
    if (!jobSiteId || !weekEndingDate) {
      return res.status(400).json({ message: 'jobSiteId and weekEndingDate are required' });
    }
    const rows = await loadHoursRows(jobSiteId, weekEndingDate);
    res.json({
      rows: rows.map((row) => ({
        ...row,
        needs_classification: !row.labor_classification,
      })),
      ...getWeekWindow(weekEndingDate),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.get('/supplements', async (req, res) => {
  try {
    const {
      jobSiteId,
      weekEndingDate,
      payPeriodId,
      paychexPayPeriodId,
      selectedWeek,
      forceRefresh,
    } = req.query;
    if (!jobSiteId || !weekEndingDate || !payPeriodId) {
      return res.status(400).json({
        message: 'jobSiteId, weekEndingDate, and payPeriodId are required',
      });
    }

    const periodWeeks = await resolvePayPeriodContext(payPeriodId);

    const result = await buildSupplementRows({
      jobSiteId,
      weekEndingDate,
      payPeriodId,
      paychexPayPeriodId: paychexPayPeriodId || periodWeeks?.paychexPeriodId || null,
      payPeriodStart: periodWeeks?.payPeriodStart,
      payPeriodEnd: periodWeeks?.payPeriodEnd,
      week1End: periodWeeks?.week1End,
      week2End: periodWeeks?.week2End,
      forceRefresh: forceRefresh === 'true',
      selectedWeek: selectedWeek || null,
    });
    res.json(result);
  } catch (error) {
    const status = error.statusCode || 500;
    res.status(status).json({ message: error.message });
  }
});

router.post('/fetch-check-data', async (req, res) => {
  try {
    const { payPeriodId, workerIds, jobSiteId, weekEndingDate } = req.body;
    if (!payPeriodId || !Array.isArray(workerIds) || workerIds.length === 0) {
      return res.status(400).json({ message: 'payPeriodId and workerIds are required' });
    }

    if (jobSiteId && weekEndingDate) {
      const cached = await fetchAndCacheCheckData({
        payPeriodId,
        jobSiteId,
        weekEndingDate,
        workerIds,
      });
      return res.json({ checks: cached });
    }

    const checks = await fetchChecksForWorkers({ payPeriodId, workerIds });
    res.json({ checks });
  } catch (error) {
    console.error('[certified-payroll/fetch-check-data]', error.message);
    res.status(500).json({ message: error.message });
  }
});

router.post('/resync', requireCertifiedPayrollLock, async (req, res) => {
  try {
    const {
      jobSiteId,
      payPeriodId,
      paychexPayPeriodId,
      weekEndingDate,
      week1End,
      week2End,
      selectedWeek,
    } = req.body;
    if (!jobSiteId || !payPeriodId || !weekEndingDate) {
      return res.status(400).json({
        message: 'jobSiteId, payPeriodId, and weekEndingDate are required',
      });
    }

    const weekEndingDates = [week1End, week2End, weekEndingDate].filter(Boolean);
    await clearSupplementCache({ jobSiteId, weekEndingDates: [...new Set(weekEndingDates)] });

    const periodWeeks = await resolvePayPeriodContext(payPeriodId, { week1End, week2End });

    const result = await buildSupplementRows({
      jobSiteId,
      weekEndingDate,
      payPeriodId,
      paychexPayPeriodId: paychexPayPeriodId || periodWeeks?.paychexPeriodId || null,
      payPeriodStart: periodWeeks?.payPeriodStart,
      payPeriodEnd: periodWeeks?.payPeriodEnd,
      week1End,
      week2End,
      forceRefresh: true,
      selectedWeek: selectedWeek || null,
    });

    res.json({ success: true, ...result });
  } catch (error) {
    console.error('[certified-payroll/resync]', error.message);
    res.status(500).json({ message: error.message });
  }
});

router.patch('/supplements', requireCertifiedPayrollLock, async (req, res) => {
  try {
    const {
      workerId,
      jobSiteId,
      weekEndingDate,
      wage_determination_no,
      fringe_benefit_credit,
      fringe_paid_in_lieu,
      gross_earned_all_work,
      deduction_withholding,
      deduction_fica,
      deduction_other,
      deduction_other_label,
      net_pay,
    } = req.body;
    const workerResult = await query(
      `SELECT employee_code
       FROM workers
       WHERE id = $1`,
      [workerId]
    );
    const paychexWorkerNumber = workerResult.rows[0]?.employee_code || null;

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
        paychexWorkerNumber,
        wage_determination_no || null,
        fringe_benefit_credit || null,
        fringe_paid_in_lieu || null,
        gross_earned_all_work || null,
        deduction_withholding || null,
        deduction_fica || null,
        deduction_other || null,
        deduction_other_label || null,
        net_pay || null,
      ]
    );
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post('/export', requireCertifiedPayrollLock, async (req, res) => {
  try {
    const { jobSiteId, weekEndingDate, payPeriodId } = req.body;
    if (!jobSiteId || !weekEndingDate) {
      return res.status(400).json({ message: 'jobSiteId and weekEndingDate are required' });
    }

    const periodWeeks = payPeriodId ? await resolvePayPeriodWeekEnds(payPeriodId) : null;
    const supplementWeekDates = periodWeeks?.weekEndingDates?.length
      ? periodWeeks.weekEndingDates
      : [weekEndingDate];

    const [companyResult, siteResult, hoursRows, supplementsResult] = await Promise.all([
      query('SELECT * FROM company_settings ORDER BY id LIMIT 1'),
      query('SELECT * FROM job_sites WHERE id = $1', [jobSiteId]),
      loadHoursRows(jobSiteId, weekEndingDate),
      query(
        `SELECT * FROM wh347_supplements
         WHERE job_site_id = $1 AND week_ending_date = ANY($2::date[])`,
        [jobSiteId, supplementWeekDates]
      ),
    ]);

    const company = companyResult.rows[0] || {};
    const site = siteResult.rows[0];
    if (!site) return res.status(404).json({ message: 'Job site not found' });

    const workers = buildWorkersFromHours(hoursRows);
    const missingClassification = workers.filter((w) => w.needsClassification);
    if (missingClassification.length > 0) {
      const names = missingClassification.map((w) =>
        `${w.last_name || ''}, ${w.first_name || ''}`.replace(/^,\s*|,\s*$/g, '').trim() ||
        w.id
      );
      return res.status(400).json({
        message:
          `Assign a labor classification before generating WH-347 for: ${names.join('; ')}`,
        workersMissingClassification: missingClassification.map((w) => ({
          workerId: w.id,
          workerName: `${w.first_name || ''} ${w.last_name || ''}`.trim(),
        })),
      });
    }

    const supplementsByWorker = buildSupplementsByWorker(supplementsResult.rows, weekEndingDate);
    const payrollNumber = (site.certified_payroll_count || 0) + 1;
    const flatten = parseFlattenFlag(req);
    const useNew = useNewWh347Export();
    // Request body drives Prime vs Subcontractor checkbox (default: prime).
    const isPrime = req.body?.isPrime !== false && req.body?.isPrime !== 'false';

    let pdfBuffer;
    if (useNew) {
      console.log(
        `[certified-payroll/export] path=new-acroform workers=${workers.length} flatten=${flatten}`
      );
      pdfBuffer = await fillWh347Form({
        project: {
          name: site.name,
          job_code: site.job_code,
          contract_number: site.contract_number,
          address: site.address,
          wage_determination_no: pickWageDetermination(site, supplementsByWorker),
          start_date: site.start_date
            ? String(site.start_date).split('T')[0]
            : null,
        },
        company,
        weekEndingDate,
        payrollNumber,
        workers,
        supplementsByWorker,
        flatten,
        isPrime,
        isFinal: Boolean(req.body?.isFinal),
      });
    } else {
      console.log(
        `[certified-payroll/export] path=legacy-drawText workers=${workers.length}`
      );
      pdfBuffer = await buildWh347PdfLegacy({
        site,
        company,
        weekEndingDate,
        payrollNumber,
        workers,
        supplementsByWorker,
      });
    }

    await query(
      `UPDATE job_sites
       SET certified_payroll_count = COALESCE(certified_payroll_count, 0) + 1
       WHERE id = $1`,
      [jobSiteId]
    );

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="WH347-${site.job_code}-${weekEndingDate}.pdf"`
    );
    res.send(pdfBuffer);
  } catch (error) {
    console.error('[certified-payroll/export]', error.message);
    res.status(error.statusCode || 500).json({ message: error.message });
  }
});

module.exports = router;
