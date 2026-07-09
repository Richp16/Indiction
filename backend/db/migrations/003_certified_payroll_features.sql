ALTER TABLE job_sites
  ADD COLUMN IF NOT EXISTS job_code TEXT;

UPDATE job_sites
SET job_code = paychex_job_id
WHERE (job_code IS NULL OR job_code = '')
  AND paychex_job_id IS NOT NULL;

ALTER TABLE job_sites
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS contract_number VARCHAR(100),
  ADD COLUMN IF NOT EXISTS certified_payroll_count INTEGER DEFAULT 0;

ALTER TABLE job_sites
  DROP COLUMN IF EXISTS last_synced_at,
  DROP COLUMN IF EXISTS paychex_job_id;

ALTER TABLE workers
  ADD COLUMN IF NOT EXISTS name TEXT;

UPDATE workers
SET name = TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, ''))
WHERE name IS NULL OR name = '';

ALTER TABLE workers
  ADD COLUMN IF NOT EXISTS pay_rate NUMERIC(10,2);

UPDATE workers
SET pay_rate = standard_rate
WHERE pay_rate IS NULL;

ALTER TABLE workers
  ADD COLUMN IF NOT EXISTS worker_type VARCHAR(2) DEFAULT 'J';

UPDATE workers
SET worker_type = 'J'
WHERE worker_type IS NULL OR worker_type = '';

CREATE TABLE IF NOT EXISTS labor_classifications (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO labor_classifications (name) VALUES
  ('Laborer'), ('Carpenter'), ('Electrician'),
  ('Plumber'), ('Ironworker'), ('Painter'),
  ('Equipment Operator'), ('Foreman')
ON CONFLICT (name) DO NOTHING;

ALTER TABLE time_entries
  ALTER COLUMN entry_date DROP NOT NULL;

ALTER TABLE time_entries
  ADD COLUMN IF NOT EXISTS labor_classification_id
    INTEGER REFERENCES labor_classifications(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS wh347_supplements (
  id SERIAL PRIMARY KEY,
  worker_id UUID REFERENCES workers(id),
  job_site_id UUID REFERENCES job_sites(id),
  week_ending_date DATE NOT NULL,
  wage_determination_no VARCHAR(100),
  fringe_benefit_credit NUMERIC(10,2),
  fringe_paid_in_lieu NUMERIC(10,2),
  gross_earned_all_work NUMERIC(10,2),
  deduction_withholding NUMERIC(10,2),
  deduction_fica NUMERIC(10,2),
  deduction_other NUMERIC(10,2),
  deduction_other_label VARCHAR(100),
  net_pay NUMERIC(10,2),
  UNIQUE(worker_id, job_site_id, week_ending_date)
);

CREATE TABLE IF NOT EXISTS company_settings (
  id INTEGER PRIMARY KEY DEFAULT 1,
  company_name VARCHAR(255),
  company_address TEXT,
  certifying_official_name VARCHAR(255),
  certifying_official_title VARCHAR(255),
  phone VARCHAR(30),
  email VARCHAR(255)
);

INSERT INTO company_settings (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;
