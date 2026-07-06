const express = require('express');
const bcrypt = require('bcrypt');
const { query } = require('../db');
const { requireRole } = require('../middleware/roleGuard');

const router = express.Router();

const ALLOWED_CREATE_ROLES = ['superintendent', 'payroll_admin'];
const ADMIN_ROLES = ['system_admin', 'payroll_admin'];

router.use(requireRole('system_admin', 'payroll_admin'));

router.get('/', async (req, res) => {
  try {
    const result = await query(
      `SELECT id, email, name, role, created_at
       FROM users
       ORDER BY created_at ASC`
    );

    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { email, password, name, role: bodyRole } = req.body;
    const role = bodyRole || 'superintendent';

    if (!email || !String(email).trim()) {
      return res.status(400).json({ message: 'Email is required' });
    }
    if (!password || !String(password).trim()) {
      return res.status(400).json({ message: 'Password is required' });
    }
    if (!ALLOWED_CREATE_ROLES.includes(role)) {
      return res.status(400).json({ message: 'Invalid role' });
    }

    const existing = await query('SELECT id FROM users WHERE email = $1', [email.trim()]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ message: 'Email already in use' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const displayName = name && String(name).trim() ? String(name).trim() : email.trim();

    const result = await query(
      `INSERT INTO users (id, email, password_hash, name, role, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW())
       RETURNING id, email, name, role, created_at`,
      [email.trim(), passwordHash, displayName, role]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    if (req.params.id === req.user.userId) {
      return res.status(400).json({ message: 'You cannot delete your own account' });
    }

    const adminCount = await query(
      `SELECT COUNT(*)::int AS count
       FROM users
       WHERE role = ANY($1::text[])`,
      [ADMIN_ROLES]
    );

    const targetUser = await query('SELECT id, role FROM users WHERE id = $1', [req.params.id]);
    if (targetUser.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const isTargetAdmin = ADMIN_ROLES.includes(targetUser.rows[0].role);
    if (isTargetAdmin && adminCount.rows[0].count <= 1) {
      return res.status(400).json({ message: 'At least one admin is required' });
    }

    await query('DELETE FROM users WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.patch('/:id/password', async (req, res) => {
  try {
    const { newPassword } = req.body;

    if (!newPassword || !String(newPassword).trim()) {
      return res.status(400).json({ message: 'New password is required' });
    }

    const existing = await query('SELECT id FROM users WHERE id = $1', [req.params.id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await query('UPDATE users SET password_hash = $1 WHERE id = $2', [
      passwordHash,
      req.params.id,
    ]);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
