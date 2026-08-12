const express = require('express');
const { requireAuth, requireRole } = require('../middleware/roleGuard');
const {
  generateSPIRows,
  generateSPICSV,
  validateSpiRows,
  stripMetadata,
  deletePayrollRow,
  sumRowHours,
} = require('../services/paychexExport');
const {
  listPayrollPayPeriods,
  resolvePayrollPeriodFromQuery,
  formatPeriodLabel,
} = require('../services/payrollPayPeriods');
const { upsertAdjustments } = require('../services/payrollAdjustments');
const { query } = require('../db');
const { requirePayrollLock } = require('../middleware/editLock');

const router = express.Router();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function sumExportHours(rows) {
  return rows.reduce((total, row) => total + sumRowHours(row), 0);
}

function parseMoneyInput(value) {
  if (value == null || value === '') return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

router.get('/pay-periods', requireAuth, async (_req, res) => {
  try {
    const periods = await listPayrollPayPeriods();
    res.json({ periods });
  } catch (error) {
    console.error('[payroll/pay-periods]', error.message);
    res.status(500).json({ message: error.message });
  }
});

/**
 * Sync OPEN pay periods from Paychex into local `pay_periods`
 * (used by Payroll / Summary / Daily Entry selectors).
 */
router.post(
  '/sync-pay-periods',
  requireRole('payroll_admin', 'system_admin'),
  requirePayrollLock,
  async (_req, res) => {
    try {
      const { syncPayPeriods } = require('../services/paychexSync');
      const result = await syncPayPeriods();
      const status = result.status === 'FAILED' ? 502 : 200;
      res.status(status).json(result);
    } catch (error) {
      console.error('[payroll/sync-pay-periods]', error.message);
      res.status(500).json({
        syncType: 'pay_periods',
        status: 'FAILED',
        message: error.message,
      });
    }
  }
);

router.get('/summary', requireAuth, async (req, res) => {
  try {
    const period = await resolvePayrollPeriodFromQuery({
      periodStart: req.query.periodStart,
      periodEnd: req.query.periodEnd,
      payPeriodId: req.query.payPeriodId,
    });

    const result = await generateSPIRows(period.id);
    if (result.notFound) {
      return res.status(404).json({ message: 'Pay period not found' });
    }

    const totalHours = Math.round(sumExportHours(result.rows) * 100) / 100;

    res.json({
      rows: result.rows,
      warnings: result.warnings,
      payPeriod: {
        id: period.id,
        start_date: period.start_date,
        end_date: period.end_date,
        startDate: period.start_date,
        endDate: period.end_date,
        label: formatPeriodLabel(period.start_date, period.end_date),
        status: period.status,
      },
      totals: {
        totalHours,
        rowCount: result.rows.length,
      },
      clientCode: process.env.PAYCHEX_CLIENT_CODE || result.clientCode || 'payroll',
    });
  } catch (error) {
    const status = error.statusCode || 500;
    res.status(status).json({ message: error.message });
  }
});

router.get('/export-csv', requireRole('payroll_admin', 'system_admin'), async (req, res) => {
  try {
    const period = await resolvePayrollPeriodFromQuery({
      periodStart: req.query.periodStart,
      periodEnd: req.query.periodEnd,
      payPeriodId: req.query.payPeriodId,
    });

    const result = await generateSPIRows(period.id);
    if (result.notFound) {
      return res.status(404).json({ message: 'Pay period not found' });
    }

    if (!result.rows.length) {
      return res.status(404).json({ message: 'No exportable entries for this pay period' });
    }

    const cleanedRows = result.rows.map(stripMetadata);
    const validationErrors = validateSpiRows(cleanedRows);
    if (validationErrors.length > 0) {
      return res.status(422).json({
        message: 'CSV validation failed',
        errors: validationErrors,
      });
    }

    const clientCode = process.env.PAYCHEX_CLIENT_CODE || result.clientCode || 'payroll';
    const { csvString, filename } = generateSPICSV(
      cleanedRows,
      clientCode,
      result.payPeriod || period
    );

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csvString);
  } catch (error) {
    const status = error.statusCode || 500;
    res.status(status).json({ message: error.message });
  }
});

router.get('/:payPeriodId/preview', requireAuth, async (req, res) => {
  try {
    const { payPeriodId } = req.params;

    if (!payPeriodId || !UUID_RE.test(payPeriodId)) {
      return res.status(400).json({ message: 'Invalid pay period ID' });
    }

    const result = await generateSPIRows(payPeriodId);

    if (result.notFound) {
      return res.status(404).json({ message: 'Pay period not found' });
    }

    res.json({
      rows: result.rows,
      warnings: result.warnings,
      payPeriod: result.payPeriod,
      clientCode: process.env.PAYCHEX_CLIENT_CODE || result.clientCode || 'payroll',
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.put(
  '/:payPeriodId/adjustments',
  requireRole('payroll_admin', 'system_admin'),
  requirePayrollLock,
  async (req, res) => {
    try {
      const { payPeriodId } = req.params;
      const { adjustments } = req.body || {};

      if (!payPeriodId || !UUID_RE.test(payPeriodId)) {
        return res.status(400).json({ message: 'Invalid pay period ID' });
      }

      if (!Array.isArray(adjustments) || adjustments.length === 0) {
        return res.status(400).json({ message: 'adjustments array is required' });
      }

      const periodResult = await query('SELECT id FROM pay_periods WHERE id = $1', [
        payPeriodId,
      ]);
      if (periodResult.rows.length === 0) {
        return res.status(404).json({ message: 'Pay period not found' });
      }

      const normalized = [];
      for (let i = 0; i < adjustments.length; i += 1) {
        const item = adjustments[i] || {};
        const workerId = item.workerId;
        if (!workerId || !UUID_RE.test(String(workerId))) {
          return res.status(400).json({
            message: `adjustments[${i}].workerId must be a worker UUID`,
          });
        }

        const reimbursementAmount = parseMoneyInput(item.reimbursementAmount);
        const shortPayAmount = parseMoneyInput(item.shortPayAmount);
        if (Number.isNaN(reimbursementAmount) || Number.isNaN(shortPayAmount)) {
          return res.status(400).json({
            message: `adjustments[${i}] has invalid reimbursementAmount or shortPayAmount`,
          });
        }

        normalized.push({
          workerId: String(workerId),
          reimbursementAmount,
          shortPayAmount,
        });
      }

      const workerCheck = await query(
        `SELECT id::text AS id FROM workers WHERE id = ANY($1::uuid[])`,
        [normalized.map((a) => a.workerId)]
      );
      const found = new Set(workerCheck.rows.map((r) => r.id));
      const missing = normalized.find((a) => !found.has(a.workerId));
      if (missing) {
        return res.status(400).json({ message: 'One or more workerId values are invalid' });
      }

      const result = await upsertAdjustments(payPeriodId, normalized, {
        asAbsolute: true,
      });

      res.json({ success: true, upserted: result.upserted });
    } catch (error) {
      console.error('[payroll/adjustments]', error.message);
      res.status(500).json({ message: error.message });
    }
  }
);

router.delete('/:payPeriodId/row', requireRole('payroll_admin', 'system_admin'), requirePayrollLock, async (req, res) => {
  try {
    const { payPeriodId } = req.params;
    const { workerDbId } = req.body;

    if (!payPeriodId || !UUID_RE.test(payPeriodId)) {
      return res.status(400).json({ message: 'Invalid pay period ID' });
    }
    if (!workerDbId || !UUID_RE.test(workerDbId)) {
      return res.status(400).json({ message: 'workerDbId is required' });
    }

    const deletedCount = await deletePayrollRow({
      payPeriodId,
      workerDbId,
    });

    if (deletedCount === 0) {
      return res.status(404).json({ message: 'No matching time entries found' });
    }

    res.json({ success: true, deletedCount });
  } catch (error) {
    const status = error.statusCode || 500;
    res.status(status).json({ message: error.message });
  }
});

router.post('/:payPeriodId/download', requireRole('payroll_admin', 'system_admin'), async (req, res) => {
  try {
    const { payPeriodId } = req.params;
    const { rows } = req.body;

    if (!payPeriodId || !UUID_RE.test(payPeriodId)) {
      return res.status(400).json({ message: 'Invalid pay period ID' });
    }

    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ message: 'rows array is required' });
    }

    const cleanedRows = rows.map(stripMetadata);
    const validationErrors = validateSpiRows(cleanedRows);

    if (validationErrors.length > 0) {
      return res.status(422).json({
        message: 'CSV validation failed',
        errors: validationErrors,
      });
    }

    const periodResult = await query(
      `SELECT start_date::text AS start_date, end_date::text AS end_date
       FROM pay_periods WHERE id = $1`,
      [payPeriodId]
    );
    if (periodResult.rows.length === 0) {
      return res.status(404).json({ message: 'Pay period not found' });
    }

    const clientCode = process.env.PAYCHEX_CLIENT_CODE || 'payroll';
    const { csvString, filename } = generateSPICSV(
      cleanedRows,
      clientCode,
      periodResult.rows[0]
    );

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csvString);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
