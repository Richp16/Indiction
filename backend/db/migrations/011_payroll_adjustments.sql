-- Migration 011: Persist per-worker reimbursement / short-pay overrides for SPI payroll

CREATE TABLE IF NOT EXISTS payroll_adjustments (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pay_period_id          UUID NOT NULL REFERENCES pay_periods(id) ON DELETE CASCADE,
  worker_id              UUID NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  reimbursement_amount   NUMERIC(12,2) NOT NULL DEFAULT 0,
  short_pay_amount       NUMERIC(12,2) NOT NULL DEFAULT 0,
  note                   TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (pay_period_id, worker_id)
);

CREATE INDEX IF NOT EXISTS idx_payroll_adjustments_pay_period
  ON payroll_adjustments (pay_period_id);

-- Down migration:
-- DROP INDEX IF EXISTS idx_payroll_adjustments_pay_period;
-- DROP TABLE IF EXISTS payroll_adjustments;
