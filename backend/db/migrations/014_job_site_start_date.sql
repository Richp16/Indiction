-- Up migration:
ALTER TABLE job_sites
  ADD COLUMN IF NOT EXISTS start_date DATE;

COMMENT ON COLUMN job_sites.start_date IS
  'Job start date used for WH-347 certified payroll week numbering (week 1 = first 7 days inclusive).';

-- Down migration:
-- ALTER TABLE job_sites DROP COLUMN IF EXISTS start_date;
