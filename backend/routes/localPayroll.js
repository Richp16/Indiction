const express = require('express');
const { requireRole } = require('../middleware/roleGuard');
const { requireGlobalEditLock } = require('../middleware/editLock');
const { requirePaychexDisabled } = require('../middleware/paychexGuard');
const {
  buildLocalPayrollReview,
  buildLocalPayrollCsv,
  markPayPeriodExported,
  finalizePayPeriod,
  reopenPayPeriod,
} = require('../services/localPayroll');
const { listAllPayPeriods } = require('../services/payrollPayPeriods');

const router = express.Router();

router.use(requireRole('system_admin', 'payroll_admin'));
router.use(requirePaychexDisabled);

router.get('/pay-periods', async (_req, res) => {
  try {
    const periods = await listAllPayPeriods();
    res.json({ periods });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.get('/:payPeriodId/review', async (req, res) => {
  try {
    const review = await buildLocalPayrollReview(req.params.payPeriodId);
    res.json(review);
  } catch (error) {
    res.status(error.statusCode || 500).json({ message: error.message });
  }
});

router.get('/:payPeriodId/export.csv', async (req, res) => {
  try {
    const review = await buildLocalPayrollReview(req.params.payPeriodId);
    const csv = buildLocalPayrollCsv(review);
    const end = review.payPeriod.endDate || review.payPeriod.end_date || 'period';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="Indiction-Payroll-${end}.csv"`
    );
    res.send(csv);
  } catch (error) {
    res.status(error.statusCode || 500).json({ message: error.message });
  }
});

router.post('/:payPeriodId/mark-exported', requireGlobalEditLock, async (req, res) => {
  try {
    const row = await markPayPeriodExported(req.params.payPeriodId);
    res.json({
      id: row.id,
      status: row.status,
      exportedAt: row.exported_at,
      finalizedAt: row.finalized_at,
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ message: error.message });
  }
});

router.post('/:payPeriodId/finalize', requireGlobalEditLock, async (req, res) => {
  try {
    const row = await finalizePayPeriod(req.params.payPeriodId);
    res.json({
      id: row.id,
      status: row.status,
      exportedAt: row.exported_at,
      finalizedAt: row.finalized_at,
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ message: error.message });
  }
});

router.post('/:payPeriodId/reopen', requireGlobalEditLock, async (req, res) => {
  try {
    if (!req.body?.confirm) {
      return res.status(400).json({
        message: 'Reopening a closed period requires confirm: true',
      });
    }
    const row = await reopenPayPeriod(req.params.payPeriodId);
    res.json({
      id: row.id,
      status: row.status,
      exportedAt: row.exported_at,
      finalizedAt: row.finalized_at,
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ message: error.message });
  }
});

module.exports = router;
