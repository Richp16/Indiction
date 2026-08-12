const express = require('express');
const { query } = require('../db');
const { requireRole } = require('../middleware/roleGuard');
const { submitPayroll, validatePayroll } = require('../services/paychexSubmit');
const { requireGlobalEditLock } = require('../middleware/editLock');

const router = express.Router();

router.use(requireRole('payroll_admin', 'system_admin'));

router.post('/validate', requireGlobalEditLock, async (req, res) => {
  try {
    const { payPeriodId } = req.body;
    if (!payPeriodId) {
      return res.status(400).json({ message: 'payPeriodId is required' });
    }

    const results = await validatePayroll(payPeriodId);
    res.json(results);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post('/confirm', requireGlobalEditLock, async (req, res) => {
  try {
    const { payPeriodId } = req.body;
    if (!payPeriodId) {
      return res.status(400).json({ message: 'payPeriodId is required' });
    }

    const results = await submitPayroll(payPeriodId, req.user.userId);
    res.json(results);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.get('/status', async (req, res) => {
  try {
    const { payPeriodId } = req.query;
    if (!payPeriodId) {
      return res.status(400).json({ message: 'payPeriodId is required' });
    }

    const result = await query(
      `SELECT
         sl.*,
         w.first_name,
         w.last_name
       FROM submission_log sl
       LEFT JOIN workers w ON sl.worker_id = w.id
       WHERE sl.pay_period_id = $1
       ORDER BY sl.submitted_at DESC`,
      [payPeriodId]
    );

    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
