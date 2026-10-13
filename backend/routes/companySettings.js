const express = require('express');
const { query } = require('../db');
const { requireRole } = require('../middleware/roleGuard');
const { requireGlobalEditLock } = require('../middleware/editLock');
const { assertModeSelectionAllowed } = require('../middleware/paychexGuard');

const router = express.Router();

router.get('/', requireRole('system_admin', 'payroll_admin'), async (_req, res) => {
  try {
    const result = await query(
      `SELECT id, company_name, company_address, certifying_official_name,
              certifying_official_title, phone, email,
              paychex_enabled, integration_configured
       FROM company_settings
       ORDER BY id
       LIMIT 1`
    );
    const row = result.rows[0] || { id: 1 };
    res.json({
      ...row,
      paychex_enabled: row.paychex_enabled !== false,
      integration_configured: row.integration_configured === true,
    });
  } catch (error) {
    const message = String(error?.message || '');
    if (message.includes('paychex_enabled') || message.includes('integration_configured')) {
      const fallback = await query(
        `SELECT id, company_name, company_address, certifying_official_name,
                certifying_official_title, phone, email
         FROM company_settings
         ORDER BY id
         LIMIT 1`
      );
      return res.json({
        ...(fallback.rows[0] || { id: 1 }),
        paychex_enabled: true,
        integration_configured: true,
      });
    }
    res.status(500).json({ message: error.message });
  }
});

router.patch(
  '/',
  requireRole('system_admin', 'payroll_admin'),
  requireGlobalEditLock,
  async (req, res) => {
    try {
      const {
        company_name,
        company_address,
        certifying_official_name,
        certifying_official_title,
        phone,
        email,
        paychex_enabled,
      } = req.body;

      const existing = await query(
        `SELECT id
         FROM company_settings
         ORDER BY id
         LIMIT 1`
      );

      const values = [
        company_name || null,
        company_address || null,
        certifying_official_name || null,
        certifying_official_title || null,
        phone || null,
        email || null,
      ];

      let paychexEnabledValue = paychex_enabled;
      if (paychexEnabledValue === undefined && existing.rows.length > 0) {
        const current = await query(
          `SELECT paychex_enabled FROM company_settings WHERE id = $1`,
          [existing.rows[0].id]
        ).catch(() => ({ rows: [] }));
        paychexEnabledValue = current.rows[0]?.paychex_enabled;
      }
      if (paychexEnabledValue === undefined) {
        paychexEnabledValue = true;
      }
      paychexEnabledValue = Boolean(paychexEnabledValue);

      let currentEnabled = false;
      if (existing.rows.length > 0) {
        const current = await query(
          `SELECT paychex_enabled FROM company_settings WHERE id = $1`,
          [existing.rows[0].id]
        ).catch(() => ({ rows: [] }));
        if (typeof current.rows[0]?.paychex_enabled === 'boolean') {
          currentEnabled = current.rows[0].paychex_enabled;
        }
      }
      if (existing.rows.length === 0 || currentEnabled !== paychexEnabledValue) {
        await assertModeSelectionAllowed(paychexEnabledValue);
      }

      let result;
      if (existing.rows.length === 0) {
        result = await query(
          `INSERT INTO company_settings (
             company_name, company_address, certifying_official_name,
             certifying_official_title, phone, email,
             paychex_enabled, integration_configured
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, true)
           RETURNING id, company_name, company_address, certifying_official_name,
                     certifying_official_title, phone, email,
                     paychex_enabled, integration_configured`,
          [...values, paychexEnabledValue]
        );
      } else {
        values.push(paychexEnabledValue);
        values.push(existing.rows[0].id);
        result = await query(
          `UPDATE company_settings
           SET company_name = $1,
               company_address = $2,
               certifying_official_name = $3,
               certifying_official_title = $4,
               phone = $5,
               email = $6,
               paychex_enabled = $7,
               integration_configured = true
           WHERE id = $8
           RETURNING id, company_name, company_address, certifying_official_name,
                     certifying_official_title, phone, email,
                     paychex_enabled, integration_configured`,
          values
        );
      }

      res.json(result.rows[0]);
    } catch (error) {
      res.status(error.statusCode || 500).json({
        message: error.message,
        code: error.code || undefined,
      });
    }
  }
);

module.exports = router;
