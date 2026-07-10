-- Up migration:
ALTER TABLE job_sites
  ADD COLUMN IF NOT EXISTS wage_determination_no VARCHAR(100) DEFAULT NULL;

ALTER TABLE wh347_supplements
  ADD COLUMN IF NOT EXISTS is_estimated BOOLEAN DEFAULT false;

ALTER TABLE wh347_supplements
  ADD COLUMN IF NOT EXISTS paychex_period_id TEXT;

-- Down migration:
-- ALTER TABLE job_sites DROP COLUMN IF EXISTS wage_determination_no;
-- ALTER TABLE wh347_supplements DROP COLUMN IF EXISTS is_estimated;
-- ALTER TABLE wh347_supplements DROP COLUMN IF EXISTS paychex_period_id;
