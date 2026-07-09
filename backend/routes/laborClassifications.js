const express = require('express');
const { query } = require('../db');
const { requireRole } = require('../middleware/roleGuard');

const router = express.Router();

router.get('/', async (_req, res) => {
  try {
    const result = await query(
      `SELECT id, name, created_at
       FROM labor_classifications
       ORDER BY name`
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post('/', requireRole('system_admin', 'payroll_admin'), async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !String(name).trim()) {
      return res.status(400).json({ message: 'name is required' });
    }
    const result = await query(
      `INSERT INTO labor_classifications (name)
       VALUES ($1)
       RETURNING id, name, created_at`,
      [String(name).trim()]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ message: 'Classification already exists' });
    }
    res.status(500).json({ message: error.message });
  }
});

router.delete('/:id', requireRole('system_admin', 'payroll_admin'), async (req, res) => {
  try {
    const result = await query(
      'DELETE FROM labor_classifications WHERE id = $1 RETURNING id',
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Classification not found' });
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
