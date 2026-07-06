const express = require('express');
const { requireRole } = require('../middleware/roleGuard');
const {
  generateSPIRows,
  generateSPICSV,
  validateSpiRows,
  stripMetadata,
} = require('../services/paychexExport');

const router = express.Router();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

router.use(requireRole('payroll_admin', 'system_admin'));

router.get('/:payPeriodId/preview', async (req, res) => {
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

router.post('/:payPeriodId/download', async (req, res) => {
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
