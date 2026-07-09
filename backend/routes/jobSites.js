const express = require('express');
const { query } = require('../db');
const { requireRole } = require('../middleware/roleGuard');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const result = await query(
      `SELECT id, name, job_code, address, contract_number, certified_payroll_count, is_active
       FROM job_sites
       ORDER BY name`
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post('/', requireRole('system_admin', 'payroll_admin'), async (req, res) => {
  try {
    const { name, job_code, address = null, contract_number = null } = req.body;
    if (!name || !String(name).trim()) {
      return res.status(400).json({ message: 'Site Name is required' });
    }
    if (!job_code || !String(job_code).trim()) {
      return res.status(400).json({ message: 'Job Code is required' });
    }

    const result = await query(
      `INSERT INTO job_sites (name, job_code, address, contract_number, is_active)
       VALUES ($1, $2, $3, $4, true)
       RETURNING id, name, job_code, address, contract_number, certified_payroll_count, is_active`,
      [String(name).trim(), String(job_code).trim(), address, contract_number]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ message: 'Job code already exists' });
    }
    res.status(500).json({ message: error.message });
  }
});

router.patch('/:id', requireRole('system_admin', 'payroll_admin'), async (req, res) => {
  try {
    const { name, job_code, address, contract_number, is_active } = req.body;
    const fields = [];
    const values = [];

    if (name !== undefined) {
      values.push(String(name).trim());
      fields.push(`name = $${values.length}`);
    }
    if (job_code !== undefined) {
      values.push(String(job_code).trim());
      fields.push(`job_code = $${values.length}`);
    }
    if (address !== undefined) {
      values.push(address);
      fields.push(`address = $${values.length}`);
    }
    if (contract_number !== undefined) {
      values.push(contract_number);
      fields.push(`contract_number = $${values.length}`);
    }
    if (is_active !== undefined) {
      values.push(Boolean(is_active));
      fields.push(`is_active = $${values.length}`);
    }

    if (fields.length === 0) {
      return res.status(400).json({ message: 'No fields provided' });
    }

    values.push(req.params.id);
    const result = await query(
      `UPDATE job_sites
       SET ${fields.join(', ')}
       WHERE id = $${values.length}
       RETURNING id, name, job_code, address, contract_number, certified_payroll_count, is_active`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Job site not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ message: 'Job code already exists' });
    }
    res.status(500).json({ message: error.message });
  }
});

router.delete('/:id', requireRole('system_admin', 'payroll_admin'), async (req, res) => {
  try {
    const result = await query('UPDATE job_sites SET is_active = false WHERE id = $1 RETURNING id', [
      req.params.id,
    ]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Job site not found' });
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
