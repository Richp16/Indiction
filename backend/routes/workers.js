const express = require('express');
const { query } = require('../db');
const { isReimbursementComponentName } = require('../config/paychex');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const { search } = req.query;
    let sql = `
      SELECT id, employee_code, first_name, last_name, is_active, standard_rate
      FROM workers
      WHERE is_active = true
        AND standard_rate IS NOT NULL
    `;
    const params = [];

    if (search) {
      params.push(`%${search}%`);
      sql += ` AND (first_name || ' ' || last_name) ILIKE $${params.length}`;
    }

    sql += ' ORDER BY last_name, first_name';

    const result = await query(sql, params);
    const workers = result.rows.map((row) => ({
      id: row.id,
      employeeCode: row.employee_code,
      firstName: row.first_name,
      lastName: row.last_name,
      isActive: row.is_active,
      standardRate: row.standard_rate != null ? parseFloat(row.standard_rate) : null,
    }));

    res.json(workers);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.get('/:id/pay-components', async (req, res) => {
  try {
    const workerResult = await query(
      `SELECT id FROM workers
       WHERE id = $1 AND is_active = true AND standard_rate IS NOT NULL`,
      [req.params.id]
    );

    if (workerResult.rows.length === 0) {
      return res.status(404).json({ message: 'Worker not found or not eligible for payroll' });
    }

    const result = await query(
      `SELECT paychex_component_id, name, rate
       FROM worker_pay_components
       WHERE worker_id = $1
       ORDER BY name`,
      [req.params.id]
    );

    const components = result.rows
      .filter((row) => isReimbursementComponentName(row.name))
      .map((row) => ({
      paychexComponentId: row.paychex_component_id,
      name: row.name,
      rate: row.rate != null ? parseFloat(row.rate) : null,
      type: 'REIMBURSEMENT',
    }));

    res.json(components);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
