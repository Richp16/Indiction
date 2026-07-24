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

const router = express.Router();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function sumExportHours(rows) {
  return rows.reduce((total, row) => total + sumRowHours(row), 0);
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
    const { csvString, filename } = generateSPICSV(cleanedRows, clientCode);

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

router.delete('/:payPeriodId/row', requireRole('payroll_admin', 'system_admin'), async (req, res) => {
  try {
    const { payPeriodId } = req.params;
    const { workerDbId, jobSiteId } = req.body;

    if (!payPeriodId || !UUID_RE.test(payPeriodId)) {
      return res.status(400).json({ message: 'Invalid pay period ID' });
    }
    if (!workerDbId || !UUID_RE.test(workerDbId)) {
      return res.status(400).json({ message: 'workerDbId is required' });
    }
    if (jobSiteId != null && jobSiteId !== '' && !UUID_RE.test(jobSiteId)) {
      return res.status(400).json({ message: 'Invalid job site ID' });
    }

    const deletedCount = await deletePayrollRow({
      payPeriodId,
      workerDbId,
      jobSiteId: jobSiteId || null,
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

    const clientCode = process.env.PAYCHEX_CLIENT_CODE || 'payroll';
    const { csvString, filename } = generateSPICSV(cleanedRows, clientCode);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csvString);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
