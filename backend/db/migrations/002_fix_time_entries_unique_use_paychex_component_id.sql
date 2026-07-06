-- Corrective migration: remove pay_code if migration 001 was partially applied with the wrong column name.
-- Safe to run even if pay_code was never added.

ALTER TABLE time_entries DROP CONSTRAINT IF EXISTS time_entries_worker_job_site_period_date_paycode_unique;
ALTER TABLE time_entries DROP COLUMN IF EXISTS pay_code;

-- Ensure the correct unique constraint exists (idempotent if 001 already applied).
ALTER TABLE time_entries DROP CONSTRAINT IF EXISTS time_entries_worker_job_site_period_date_component_unique;

ALTER TABLE time_entries DROP CONSTRAINT IF EXISTS time_entries_worker_id_job_site_id_paychex_component_id_entry_date_key;
ALTER TABLE time_entries DROP CONSTRAINT IF EXISTS time_entries_worker_id_job_site_id_entry_date_key;
ALTER TABLE time_entries DROP CONSTRAINT IF EXISTS time_entries_worker_id_job_site_id_pay_period_id_entry_date_key;

ALTER TABLE time_entries ADD CONSTRAINT time_entries_worker_job_site_period_date_component_unique
  UNIQUE (worker_id, job_site_id, pay_period_id, entry_date, paychex_component_id);
