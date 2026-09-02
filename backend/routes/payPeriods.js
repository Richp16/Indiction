const express = require('express');
const { requireRole } = require('../middleware/roleGuard');
const { requireGlobalEditLock } = require('../middleware/editLock');
const { requirePaychexDisabled } = require('../middleware/paychexGuard');
const {
  listAllPayPeriods,
  createManualPayPeriod,
  updateManualPayPeriod,
  deleteManualPayPeriod,
} = require('../services/payrollPayPeriods');

const router = express.Router();

router.get('/', requireRole('system_admin', 'payroll_admin'), async (_req, res) => {
  try {
    const periods = await listAllPayPeriods();
    res.json(periods);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post(
  '/',
  requireRole('system_admin', 'payroll_admin'),
  requirePaychexDisabled,
  requireGlobalEditLock,
  async (req, res) => {
    try {
      const { startDate, endDate, submitByDate, payDate, status } = req.body || {};
      const period = await createManualPayPeriod({
        startDate,
        endDate,
        submitByDate,
        payDate,
        status,
      });
      res.status(201).json(period);
    } catch (error) {
      res.status(error.statusCode || 500).json({ message: error.message });
    }
  }
);

router.patch(
  '/:id',
  requireRole('system_admin', 'payroll_admin'),
  requirePaychexDisabled,
  requireGlobalEditLock,
  async (req, res) => {
    try {
      const period = await updateManualPayPeriod(req.params.id, req.body || {});
      res.json(period);
    } catch (error) {
      res.status(error.statusCode || 500).json({ message: error.message });
    }
  }
);

router.delete(
  '/:id',
  requireRole('system_admin', 'payroll_admin'),
  requirePaychexDisabled,
  requireGlobalEditLock,
  async (req, res) => {
    try {
      const result = await deleteManualPayPeriod(req.params.id);
      res.json(result);
    } catch (error) {
      res.status(error.statusCode || 500).json({ message: error.message });
    }
  }
);

module.exports = router;
