const express = require('express');
const { query } = require('../db');
const { requireRole } = require('../middleware/roleGuard');
const { requireAdminConfigLock } = require('../middleware/editLock');

const router = express.Router();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

router.get('/', requireRole('system_admin', 'payroll_admin'), async (_req, res) => {
  try {
    const [overridesResult, workersResult, sitesResult] = await Promise.all([
      query(
        `SELECT
           r.id,
           r.worker_id,
           r.job_site_id,
           r.rate,
           TRIM(w.first_name || ' ' || w.last_name) AS worker_name,
           w.last_name,
           w.first_name,
           w.employee_code,
           w.standard_rate,
           js.name AS job_site_name,
           js.job_code
         FROM worker_job_site_rates r
         JOIN workers w ON w.id = r.worker_id
         JOIN job_sites js ON js.id = r.job_site_id
         ORDER BY w.last_name, w.first_name, js.name`
      ),
      query(
        `SELECT
           id,
           employee_code,
           first_name,
           last_name,
           standard_rate,
           is_active
         FROM workers
         WHERE is_active = true
         ORDER BY last_name, first_name`
      ),
      query(
        `SELECT id, name, job_code, is_active
         FROM job_sites
         WHERE is_active = true
         ORDER BY name`
      ),
    ]);

    res.json({
      overrides: overridesResult.rows.map((row) => ({
        id: row.id,
        workerId: row.worker_id,
        workerName: row.worker_name,
        employeeCode: row.employee_code,
        standardRate:
          row.standard_rate != null ? parseFloat(row.standard_rate) : null,
        jobSiteId: row.job_site_id,
        jobSiteName: row.job_site_name,
        jobCode: row.job_code,
        rate: parseFloat(row.rate),
      })),
      workers: workersResult.rows.map((row) => ({
        id: row.id,
        employeeCode: row.employee_code,
        firstName: row.first_name,
        lastName: row.last_name,
        name: `${row.last_name}, ${row.first_name}`,
        standardRate:
          row.standard_rate != null ? parseFloat(row.standard_rate) : null,
        isActive: row.is_active,
      })),
      jobSites: sitesResult.rows.map((row) => ({
        id: row.id,
        name: row.name,
        jobCode: row.job_code,
        isActive: row.is_active,
      })),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post('/', requireRole('system_admin', 'payroll_admin'), requireAdminConfigLock, async (req, res) => {
  try {
    const { workerId, jobSiteId, rate } = req.body || {};

    if (!workerId || !UUID_RE.test(String(workerId))) {
      return res.status(400).json({ message: 'workerId must be a valid UUID' });
    }
    if (!jobSiteId || !UUID_RE.test(String(jobSiteId))) {
      return res.status(400).json({ message: 'jobSiteId must be a valid UUID' });
    }

    const parsedRate = Number(rate);
    if (!Number.isFinite(parsedRate) || parsedRate <= 0) {
      return res.status(400).json({ message: 'rate must be a positive number' });
    }

    const [workerCheck, siteCheck] = await Promise.all([
      query(`SELECT id, standard_rate FROM workers WHERE id = $1`, [workerId]),
      query(`SELECT id, name FROM job_sites WHERE id = $1`, [jobSiteId]),
    ]);
    if (workerCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Worker not found' });
    }
    if (siteCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Job site not found' });
    }

    const result = await query(
      `INSERT INTO worker_job_site_rates (worker_id, job_site_id, rate)
       VALUES ($1, $2, $3)
       ON CONFLICT (worker_id, job_site_id)
       DO UPDATE SET
         rate = EXCLUDED.rate,
         updated_at = now()
       RETURNING id, worker_id, job_site_id, rate, created_at, updated_at`,
      [workerId, jobSiteId, Math.round(parsedRate * 100) / 100]
    );

    const row = result.rows[0];
    res.status(201).json({
      id: row.id,
      workerId: row.worker_id,
      jobSiteId: row.job_site_id,
      rate: parseFloat(row.rate),
      standardRate:
        workerCheck.rows[0].standard_rate != null
          ? parseFloat(workerCheck.rows[0].standard_rate)
          : null,
      jobSiteName: siteCheck.rows[0].name,
      updatedAt: row.updated_at,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.delete('/:id', requireRole('system_admin', 'payroll_admin'), requireAdminConfigLock, async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || !UUID_RE.test(String(id))) {
      return res.status(400).json({ message: 'Invalid override id' });
    }

    const result = await query(
      `DELETE FROM worker_job_site_rates WHERE id = $1 RETURNING id`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Override not found' });
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
