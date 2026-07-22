-- Migration 010: Persist Paychex-discovered pay periods (source of truth for /checks)

CREATE TABLE IF NOT EXISTS paychex_pay_periods (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      TEXT NOT NULL,
  pay_period_id   TEXT NOT NULL,
  interval_code   TEXT,
  status          TEXT,
  description     TEXT,
  start_date      DATE,
  end_date        DATE,
  submit_by_date  DATE,
  check_date      DATE,
  check_count     INTEGER,
  raw_json        JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT paychex_pay_periods_company_period_unique UNIQUE (company_id, pay_period_id)
);

CREATE INDEX IF NOT EXISTS idx_paychex_pay_periods_company_end_date
  ON paychex_pay_periods (company_id, end_date DESC);

CREATE INDEX IF NOT EXISTS idx_paychex_pay_periods_company_status
  ON paychex_pay_periods (company_id, status);

-- Down migration:
-- DROP INDEX IF EXISTS idx_paychex_pay_periods_company_status;
-- DROP INDEX IF EXISTS idx_paychex_pay_periods_company_end_date;
-- DROP TABLE IF EXISTS paychex_pay_periods;
