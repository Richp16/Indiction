const express = require('express');
const { query } = require('../db');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const result = await query(
      `SELECT id, name, paychex_job_id
       FROM job_sites
       WHERE is_active = true
       ORDER BY name`
    );

    const jobSites = result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      paychexJobId: row.paychex_job_id,
    }));

    res.json(jobSites);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
