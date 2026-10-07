ALTER TABLE workers
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS identifying_last4 VARCHAR(4);

-- Unique employee codes when present (multiple NULLs remain allowed).
CREATE UNIQUE INDEX IF NOT EXISTS workers_employee_code_unique
  ON workers (employee_code)
  WHERE employee_code IS NOT NULL AND TRIM(employee_code) <> '';

ALTER TABLE pay_periods
  ADD COLUMN IF NOT EXISTS exported_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS finalized_at TIMESTAMPTZ;
