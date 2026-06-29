const express = require('express');
const { query } = require('../db');
const { getAggregatedSummary, generateCSV } = require('../services/aggregation');

const router = express.Router();

async function getCurrentPayPeriod(req, res) {
  try {
    const result = await query(
      `SELECT * FROM pay_periods
       WHERE status = 'OPEN'
       ORDER BY start_date DESC
       LIMIT 1`
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'No open pay period found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

router.get('/current', getCurrentPayPeriod);

router.get('/csv', async (req, res) => {
  try {
    const { payPeriodId } = req.query;
    if (!payPeriodId) {
      return res.status(400).json({ message: 'payPeriodId is required' });
    }

    const periodResult = await query(
      'SELECT start_date FROM pay_periods WHERE id = $1',
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

module.exports = router;
module.exports.getCurrentPayPeriod = getCurrentPayPeriod;
