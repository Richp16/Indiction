const express = require('express');
const { query } = require('../db');
const { getAggregatedSummary, getCompanyEarnings, generateCSV, EMPLOYER_LIABILITY_RATE } = require('../services/aggregation');
const { subtractBusinessDays } = require('../utils/businessDays');
const { requireRole } = require('../middleware/roleGuard');
const {
  findCurrentPayPeriod,
  resolvePayrollPeriodFromQuery,
  formatPeriodLabel,
} = require('../services/payrollPayPeriods');

const router = express.Router();

async function getCurrentPayPeriod(req, res) {
  try {
    const period = await findCurrentPayPeriod();

    if (!period) {
      return res.status(404).json({ message: 'No open pay period found' });
    }

    res.json(period);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function loadPeriodEntries(payPeriodId) {
  const result = await query(
    `SELECT
       d.id,
       d.worker_id,
       d.job_site_id,
       d.date_worked AS entry_date,
       d.hours_worked AS hours,
       d.pay_code,
       d.paychex_component_id,
       d.component_name,
       d.component_rate,
       d.reimbursement_amount,
       d.pay_period_id,
       d.pay_period_end_date,
       d.labor_classification_id,
       d.week_number,
       d.entered_by,
       d.created_at,
       w.first_name AS worker_first_name,
       w.last_name AS worker_last_name,
       js.name AS job_site_name
     FROM daily_time_entries d
     JOIN workers w ON d.worker_id = w.id
     LEFT JOIN job_sites js ON d.job_site_id = js.id
     WHERE d.pay_period_id = $1
     ORDER BY d.date_worked DESC, w.last_name, w.first_name`,
    [payPeriodId]
  );
  return result.rows;
}

router.get('/current', getCurrentPayPeriod);

router.get('/analysis', async (req, res) => {
  try {
    const period = await resolvePayrollPeriodFromQuery({
      periodStart: req.query.periodStart,
      periodEnd: req.query.periodEnd,
      payPeriodId: req.query.payPeriodId,
    });

    const [rows, totalEarnings, entries] = await Promise.all([
      getAggregatedSummary(period.id),
      getCompanyEarnings(period.id),
      loadPeriodEntries(period.id),
    ]);
    const employerLiability = totalEarnings * EMPLOYER_LIABILITY_RATE;

    res.json({
      payPeriod: {
        id: period.id,
        start_date: period.start_date,
        end_date: period.end_date,
        startDate: period.start_date,
        endDate: period.end_date,
        label: formatPeriodLabel(period.start_date, period.end_date),
        status: period.status,
      },
      rows,
      entries,
      totalEarnings,
      employerLiability,
    });
  } catch (error) {
    const status = error.statusCode || 500;
    res.status(status).json({ message: error.message });
  }
});

router.get('/csv', requireRole('system_admin', 'payroll_admin'), async (req, res) => {
  try {
    const { payPeriodId } = req.query;
    if (!payPeriodId) {
      return res.status(400).json({ message: 'payPeriodId is required' });
    }

    const periodResult = await query(
      'SELECT start_date::text AS start_date FROM pay_periods WHERE id = $1',
      [payPeriodId]
    );

    if (periodResult.rows.length === 0) {
      return res.status(404).json({ message: 'Pay period not found' });
    }

    const rows = await getAggregatedSummary(payPeriodId);
    const csv = generateCSV(rows);
    const startDate = periodResult.rows[0].start_date;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="payroll-summary-${startDate}.csv"`
    );
    res.send(csv);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const { payPeriodId } = req.query;
    if (!payPeriodId) {
      return res.status(400).json({ message: 'payPeriodId is required' });
    }

    const rows = await getAggregatedSummary(payPeriodId);
    const totalEarnings = await getCompanyEarnings(payPeriodId);
    const employerLiability = totalEarnings * EMPLOYER_LIABILITY_RATE;

    res.json({ rows, totalEarnings, employerLiability });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

async function getAlerts(req, res) {
  try {
    const result = await query(
      `SELECT
         id,
         paychex_period_id,
         start_date::text,
         end_date::text,
         submit_by_date::text,
         pay_date::text
       FROM pay_periods
       WHERE status = 'OPEN'
         AND submit_by_date >= CURRENT_DATE
         AND submit_by_date <= CURRENT_DATE + INTERVAL '3 days'
       ORDER BY submit_by_date ASC`
    );

    const today = new Date().toISOString().split('T')[0];

    const alerts = result.rows.map((period) => {
      const internalDeadline = subtractBusinessDays(period.pay_date, 3);
      const severity = internalDeadline === today ? 'error' : 'warning';

      return {
        type: 'deadline',
        severity,
        message: `Payroll due ${internalDeadline} — submit by end of day`,
        periodId: period.id,
        paychexPeriodId: period.paychex_period_id,
        submitByDate: period.submit_by_date,
        payDate: period.pay_date,
      };
    });

    res.json({ alerts });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

module.exports = router;
module.exports.getCurrentPayPeriod = getCurrentPayPeriod;
module.exports.getAlerts = getAlerts;
