-- Migration: fix time_entries unique constraint for multi pay-type same-day entries
-- Table: time_entries. Pay type column: paychex_component_id (REGULAR, OT, PTO, REIMBURSE, etc.)
-- Run manually against the FieldPay database (e.g. psql or PgAdmin).

-- Remove incorrect pay_code column/constraint if a prior version of this migration was applied.
ALTER TABLE time_entries DROP CONSTRAINT IF EXISTS time_entries_worker_job_site_period_date_paycode_unique;
ALTER TABLE time_entries DROP COLUMN IF EXISTS pay_code;

-- Drop legacy unique constraints that may block different pay types on the same day.
ALTER TABLE time_entries DROP CONSTRAINT IF EXISTS time_entries_worker_id_job_site_id_paychex_component_id_entry_date_key;
ALTER TABLE time_entries DROP CONSTRAINT IF EXISTS entries_worker_id_job_site_id_entry_date_key;
ALTER TABLE time_entries DROP CONSTRAINT IF EXISTS entries_worker_id_job_site_id_pay_period_id_entry_date_key;
ALTER TABLE time_entries DROP CONSTRAINT IF EXISTS time_entries_worker_id_job_site_id_entry_date_key;
ALTER TABLE time_entries DROP CONSTRAINT IF EXISTS time_entries_worker_id_job_site_id_pay_period_id_entry_date_key;

ALTER TABLE time_entries ADD CONSTRAINT time_entries_worker_job_site_period_date_component_unique
  UNIQUE (worker_id, job_site_id, pay_period_id, entry_date, paychex_component_id);
