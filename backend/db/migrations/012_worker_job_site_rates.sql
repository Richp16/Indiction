-- Migration 012: Per-job-site worker pay rate overrides (additive; starts empty)

CREATE TABLE IF NOT EXISTS worker_job_site_rates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id   UUID NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  job_site_id UUID NOT NULL REFERENCES job_sites(id) ON DELETE CASCADE,
  rate        NUMERIC(10,2) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (worker_id, job_site_id)
);

CREATE INDEX IF NOT EXISTS idx_worker_job_site_rates_worker
  ON worker_job_site_rates (worker_id);

CREATE INDEX IF NOT EXISTS idx_worker_job_site_rates_job_site
  ON worker_job_site_rates (job_site_id);

-- Down migration:
-- DROP INDEX IF EXISTS idx_worker_job_site_rates_job_site;
-- DROP INDEX IF EXISTS idx_worker_job_site_rates_worker;
-- DROP TABLE IF EXISTS worker_job_site_rates;
