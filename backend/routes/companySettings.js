const express = require('express');
const { query } = require('../db');
const { requireRole } = require('../middleware/roleGuard');
const { requireAdminConfigLock } = require('../middleware/editLock');

const router = express.Router();

router.get('/', requireRole('system_admin', 'payroll_admin'), async (_req, res) => {
  try {
    const result = await query(
      `SELECT id, company_name, company_address, certifying_official_name,
              certifying_official_title, phone, email
       FROM company_settings
       ORDER BY id
       LIMIT 1`
    );
    res.json(result.rows[0] || { id: 1 });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.patch(
  '/',
  requireRole('system_admin', 'payroll_admin'),
  requireAdminConfigLock,
  async (req, res) => {
    try {
      const {
        company_name,
        company_address,
        certifying_official_name,
        certifying_official_title,
        phone,
        email,
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

      let result;
      if (existing.rows.length === 0) {
        result = await query(
          `INSERT INTO company_settings (
             company_name, company_address, certifying_official_name,
             certifying_official_title, phone, email
           ) VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id, company_name, company_address, certifying_official_name,
                     certifying_official_title, phone, email`,
          values
        );
      } else {
        values.push(existing.rows[0].id);
        result = await query(
          `UPDATE company_settings
           SET company_name = $1,
               company_address = $2,
               certifying_official_name = $3,
               certifying_official_title = $4,
               phone = $5,
               email = $6
           WHERE id = $7
           RETURNING id, company_name, company_address, certifying_official_name,
                     certifying_official_title, phone, email`,
          values
        );
      }

      res.json(result.rows[0]);
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  }
);

module.exports = router;
