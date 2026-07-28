const { query } = require('./index');

/**
 * Resolve the pay rate for a worker at a job site.
 * Prefer worker_job_site_rates.rate when present; else workers.standard_rate.
 */
async function getEffectiveRate(workerId, jobSiteId) {
  if (!workerId) return 0;

  if (!jobSiteId) {
    const result = await query(
      `SELECT COALESCE(standard_rate, 0) AS effective_rate
       FROM workers
       WHERE id = $1`,
      [workerId]
    );
    return Number(result.rows[0]?.effective_rate) || 0;
  }

  const result = await query(
    `SELECT COALESCE(r.rate, w.standard_rate, 0) AS effective_rate
     FROM workers w
     LEFT JOIN worker_job_site_rates r
       ON r.worker_id = w.id AND r.job_site_id = $2
     WHERE w.id = $1`,
    [workerId, jobSiteId]
  );
  return Number(result.rows[0]?.effective_rate) || 0;
}

module.exports = {
  getEffectiveRate,
};
