ALTER TABLE company_settings
  ADD COLUMN IF NOT EXISTS paychex_enabled BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE company_settings
  ADD COLUMN IF NOT EXISTS integration_configured BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE workers
  ALTER COLUMN paychex_worker_id DROP NOT NULL;

ALTER TABLE pay_periods
  ALTER COLUMN paychex_period_id DROP NOT NULL;
