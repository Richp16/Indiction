const express = require('express');
const { query } = require('../db');
const { requireRole } = require('../middleware/roleGuard');
const { runFullSync } = require('../services/paychexSync');

const router = express.Router();

router.use(requireRole('system_admin'));

router.post('/sync', async (req, res) => {
  try {
    const results = await runFullSync();
    res.json({ success: true, results });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.get('/sync/status', async (req, res) => {
  try {
    const result = await query(
      `SELECT sync_type, MAX(ran_at) AS last_ran_at, status
       FROM sync_log
       WHERE id IN (
         SELECT DISTINCT ON (sync_type) id
         FROM sync_log
         ORDER BY sync_type, ran_at DESC
       )
       ORDER BY sync_type`
    );

    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.get('/settings/workers', async (req, res) => {
  try {
    const result = await query(
      `SELECT id, paychex_worker_id, employee_code, first_name, last_name, is_active, last_synced_at
       FROM workers
       ORDER BY last_name, first_name`
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.get('/settings/job-sites', async (req, res) => {
  try {
    const result = await query(
      `SELECT id, paychex_job_id, name, is_active, last_synced_at
       FROM job_sites
       ORDER BY name`
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
