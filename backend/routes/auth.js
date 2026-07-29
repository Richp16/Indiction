const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { query } = require('../db');
const { runAllSyncsGuarded } = require('../services/paychexSyncScheduler');

const router = express.Router();

// Slightly above the 6-hour scheduled cadence to avoid redundant login triggers.
const LOGIN_SYNC_STALE_THRESHOLD_MS =
  Number(process.env.LOGIN_SYNC_STALE_THRESHOLD_MS) || 7 * 60 * 60 * 1000;

async function triggerSyncIfStale() {
  const { rows } = await query(
    `SELECT MAX(ran_at) AS last_sync FROM sync_log WHERE status = 'SUCCESS'`
  );
  const lastSync = rows[0]?.last_sync ? new Date(rows[0].last_sync) : null;
  const isStale =
    !lastSync || Date.now() - lastSync.getTime() > LOGIN_SYNC_STALE_THRESHOLD_MS;

  if (isStale) {
    runAllSyncsGuarded('login').catch(() => {});
  }
}

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const result = await query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];

    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const token = jwt.sign(
      { userId: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        name: user.name || null,
      },
    });

    triggerSyncIfStale().catch(() => {});
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
