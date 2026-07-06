const express = require('express');
const { query } = require('../db');
const { getAggregatedSummary, generateCSV } = require('../services/aggregation');
const { subtractBusinessDays } = require('../utils/businessDays');
const { requireRole } = require('../middleware/roleGuard');

const router = express.Router();

const PAY_PERIOD_SELECT = `
  SELECT
    id,
    paychex_period_id,
    start_date::text,
    end_date::text,
    submit_by_date::text,
    pay_date::text,
    status,
    week1_start::text,
    week1_end::text,
    week2_start::text,
    week2_end::text
  FROM pay_periods`;

async function findCurrentPayPeriod() {
  let result = await query(
    `${PAY_PERIOD_SELECT}
     WHERE status = 'OPEN'
       AND start_date <= CURRENT_DATE
       AND end_date >= CURRENT_DATE
     ORDER BY start_date DESC
     LIMIT 1`
  );

  if (result.rows.length > 0) {
    return result.rows[0];
  }

  result = await query(
    `${PAY_PERIOD_SELECT}
     WHERE status = 'OPEN'
       AND start_date > CURRENT_DATE
     ORDER BY start_date ASC
     LIMIT 1`
  );

  return result.rows[0] || null;
}

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

router.get('/current', getCurrentPayPeriod);

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
    res.json(rows);
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
