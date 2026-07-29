-- Migration 013: Cache Paychex recurring reimbursement amounts per worker

CREATE TABLE IF NOT EXISTS worker_recurring_reimbursements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id UUID NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  paychex_worker_id TEXT NOT NULL,
  paychex_pay_component_id TEXT NOT NULL,
  component_name TEXT,
  amount NUMERIC(12,2) NOT NULL,
  recurring BOOLEAN NOT NULL DEFAULT true,
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (worker_id, paychex_pay_component_id)
);

CREATE INDEX IF NOT EXISTS idx_worker_recurring_reimb_worker
  ON worker_recurring_reimbursements (worker_id);

-- Down migration:
-- DROP TABLE IF EXISTS worker_recurring_reimbursements;
