const express = require('express');
const { query } = require('../db');
const { getAggregatedSummary, getCompanyEarnings, getCompanyReimbursements, generateCSV, EMPLOYER_LIABILITY_RATE } = require('../services/aggregation');
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

async function getPayPeriodForDate(req, res) {
  try {
    const date = String(req.query.date || '').split('T')[0];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ message: 'date query param (YYYY-MM-DD) is required' });
    }
    const { resolvePayPeriodForDate } = require('../services/payPeriodResolver');
    const period = await resolvePayPeriodForDate(date);
    res.json(period);
  } catch (error) {
    const status = error.statusCode || 500;
    res.status(status).json({ message: error.message });
  }
}

async function loadPeriodEntries(payPeriodId, { enteredBy, workerId } = {}) {
  const params = [payPeriodId];
  const clauses = ['d.pay_period_id = $1'];

  if (enteredBy) {
    params.push(enteredBy);
    clauses.push(`d.entered_by = $${params.length}`);
  }
  if (workerId) {
    params.push(workerId);
    clauses.push(`d.worker_id = $${params.length}`);
  }

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
       w.employee_code AS worker_employee_code,
       js.name AS job_site_name,
       u.name AS entered_by_name,
       u.email AS entered_by_email
     FROM daily_time_entries d
     JOIN workers w ON d.worker_id = w.id
     LEFT JOIN job_sites js ON d.job_site_id = js.id
     LEFT JOIN users u ON d.entered_by = u.id
     WHERE ${clauses.join(' AND ')}
     ORDER BY d.date_worked DESC, w.last_name, w.first_name`,
    params
  );
  return result.rows;
}

function csvEscape(value) {
  if (value == null) return '';
  return `"${String(value).replace(/"/g, '""')}"`;
}

/** Format numeric fields without intermediate rounding — use DB string as-is. */
function csvNumeric(value) {
  if (value == null || value === '') return '';
  return String(value);
}

router.get('/current', getCurrentPayPeriod);

router.get('/analysis', requireRole('system_admin', 'payroll_admin'), async (req, res) => {
  try {
    const period = await resolvePayrollPeriodFromQuery({
      periodStart: req.query.periodStart,
      periodEnd: req.query.periodEnd,
      payPeriodId: req.query.payPeriodId,
    });

    const [rows, earnings, reimbursements] = await Promise.all([
      getAggregatedSummary(period.id),
      getCompanyEarnings(period.id),
      getCompanyReimbursements(period.id),
    ]);
    const totalEarnings = earnings.total;
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
      totalEarnings,
      regularEarnings: earnings.regular,
      overtimeEarnings: earnings.overtimeTotal,
      totalReimbursements: reimbursements.total,
      internalReimbursements: reimbursements.internal,
      paychexRecurringReimbursements: reimbursements.paychexRecurring,
      employerLiability,
    });
  } catch (error) {
    const status = error.statusCode || 500;
    res.status(status).json({ message: error.message });
  }
});

const ADMIN_ROLES = ['system_admin', 'payroll_admin'];

/** Daily entries for verification — supervisors see only their own; admins see all. */
router.get('/my-entries', async (req, res) => {
  try {
    const period = await resolvePayrollPeriodFromQuery({
      periodStart: req.query.periodStart,
      periodEnd: req.query.periodEnd,
      payPeriodId: req.query.payPeriodId,
    });

    const isAdmin = ADMIN_ROLES.includes(req.user?.role);
    const entries = await loadPeriodEntries(period.id, {
      ...(isAdmin ? {} : { enteredBy: req.user.userId }),
      workerId: req.query.workerId || undefined,
    });

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
      entries,
      scope: isAdmin ? 'all' : 'own',
    });
  } catch (error) {
    const status = error.statusCode || 500;
    res.status(status).json({ message: error.message });
  }
});

/**
 * Admin CSV export of My Entries table (same query as /my-entries).
 */
async function exportMyEntriesCsv(req, res) {
  try {
    const period = await resolvePayrollPeriodFromQuery({
      periodStart: req.query.periodStart,
      periodEnd: req.query.periodEnd,
      payPeriodId: req.query.payPeriodId,
    });

    const entries = await loadPeriodEntries(period.id, {
      workerId: req.query.workerId || undefined,
    });

    const header = 'Date,Worker Name,Job Site,Pay Code,Hours,Reimbursement\n';
    const csvBody = entries
      .map((r) =>
        [
          String(r.entry_date || '').split('T')[0],
          `${r.worker_first_name || ''} ${r.worker_last_name || ''}`.trim(),
          r.job_site_name || '',
          r.component_name || r.paychex_component_id || r.pay_code || '',
          csvNumeric(r.hours),
          csvNumeric(r.reimbursement_amount),
        ]
          .map(csvEscape)
          .join(',')
      )
      .join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="my-entries-${period.id}.csv"`
    );
    res.send(header + csvBody);
  } catch (error) {
    console.error('[export] Failed to export daily entries:', error);
    const status = error.statusCode || 500;
    res.status(status).json({
      message: error.message || 'Failed to export entries',
      error: 'Failed to export entries',
    });
  }
}

router.get(
  '/my-entries/export',
  requireRole('system_admin', 'payroll_admin'),
  exportMyEntriesCsv
);

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

router.get('/', requireRole('system_admin', 'payroll_admin'), async (req, res) => {
  try {
    const { payPeriodId } = req.query;
    if (!payPeriodId) {
      return res.status(400).json({ message: 'payPeriodId is required' });
    }

    const [rows, earnings, reimbursements] = await Promise.all([
      getAggregatedSummary(payPeriodId),
      getCompanyEarnings(payPeriodId),
      getCompanyReimbursements(payPeriodId),
    ]);
    const totalEarnings = earnings.total;
    const employerLiability = totalEarnings * EMPLOYER_LIABILITY_RATE;

    res.json({
      rows,
      totalEarnings,
      regularEarnings: earnings.regular,
      overtimeEarnings: earnings.overtimeTotal,
      totalReimbursements: reimbursements.total,
      internalReimbursements: reimbursements.internal,
      paychexRecurringReimbursements: reimbursements.paychexRecurring,
      employerLiability,
    });
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
module.exports.getPayPeriodForDate = getPayPeriodForDate;
module.exports.getAlerts = getAlerts;
module.exports.exportMyEntriesCsv = exportMyEntriesCsv;
