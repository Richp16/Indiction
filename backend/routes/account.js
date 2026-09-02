const express = require('express');
const { query } = require('../db');
const { requireRole } = require('../middleware/roleGuard');
const { getAppConfig } = require('../middleware/paychexGuard');

const router = express.Router();

router.get('/mode', async (_req, res) => {
  try {
    const config = await getAppConfig();
    res.json(config);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post('/setup', requireRole('system_admin', 'payroll_admin'), async (req, res) => {
  try {
    const paychexEnabled = req.body?.paychexEnabled !== false;
    const existing = await query(
      `SELECT id FROM company_settings ORDER BY id LIMIT 1`
    );

    let result;
    if (existing.rows.length === 0) {
      result = await query(
        `INSERT INTO company_settings (paychex_enabled, integration_configured)
         VALUES ($1, true)
         RETURNING paychex_enabled, integration_configured`,
        [paychexEnabled]
      );
    } else {
      result = await query(
        `UPDATE company_settings
         SET paychex_enabled = $1,
             integration_configured = true
         WHERE id = $2
         RETURNING paychex_enabled, integration_configured`,
        [paychexEnabled, existing.rows[0].id]
      );
    }

    const row = result.rows[0];
    res.json({
      paychexEnabled: row.paychex_enabled !== false,
      integrationConfigured: row.integration_configured === true,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

/** @deprecated Prefer GET /api/app-config */
router.get('/features', async (_req, res) => {
  try {
    const config = await getAppConfig();
    res.json({ paychexEnabled: config.paychexEnabled });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
