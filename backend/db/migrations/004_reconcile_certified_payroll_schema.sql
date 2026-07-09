-- Corrective migration for certified-payroll schema drift.
--
-- Live schema findings before this migration:
-- - workers.id is UUID PK; identifying number used by existing payroll export is workers.employee_code,
--   while workers.paychex_worker_id is the Paychex API worker identifier used for sync/submission.
-- - job_sites.id is UUID PK; job_sites currently has only id, job_code, name, is_active, last_synced_at.
--   address, contract_number, and certified_payroll_count are missing in the live DB.
-- - time_entries.id/worker_id/job_site_id/pay_period_id are UUID-based; entry_date exists as DATE NOT NULL.
--   labor_classification_id already exists as INTEGER and should match labor_classifications.id.
-- - labor_classifications exists with id SERIAL/INTEGER PK.
-- - wh347_supplements exists with UUID FKs to workers/job_sites and currently has 0 rows.
--   It is safe to recreate in development to add paychex_worker_number consistently.
-- - company_settings does not exist in the live DB.
--
-- Code paths relying on this schema:
-- - Existing payroll/CSV export uses workers.employee_code as the displayed worker identifying number.
-- - entry_date and labor_classification_id are written in routes/entries.js.
-- - wh347_supplements is read/written in routes/certifiedPayroll.js.
-- - company_settings is read/written in routes/companySettings.js and routes/certifiedPayroll.js.
--
-- Note: prior migration 003 attempted broader schema changes. This corrective migration does not rewrite
-- old migrations; it only reconciles the live database to the types and columns the current code expects.

ALTER TABLE job_sites
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS contract_number VARCHAR(100),
  ADD COLUMN IF NOT EXISTS certified_payroll_count INTEGER DEFAULT 0;

ALTER TABLE workers
  ADD COLUMN IF NOT EXISTS first_name VARCHAR(100),
  ADD COLUMN IF NOT EXISTS last_name VARCHAR(100),
  ADD COLUMN IF NOT EXISTS worker_type VARCHAR(2);

ALTER TABLE workers
  ALTER COLUMN worker_type SET DEFAULT 'J';

UPDATE workers
SET worker_type = 'J'
WHERE worker_type IS NULL
   OR worker_type = ''
   OR worker_type NOT IN ('J', 'RA');

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'workers'
      AND column_name = 'name'
  ) THEN
    UPDATE workers
    SET first_name = COALESCE(NULLIF(first_name, ''), SPLIT_PART(name, ' ', 1)),
        last_name = COALESCE(
          NULLIF(last_name, ''),
          CASE
            WHEN POSITION(' ' IN name) > 0
              THEN SUBSTRING(name FROM POSITION(' ' IN name) + 1)
            ELSE ''
          END
        )
    WHERE name IS NOT NULL
      AND (first_name IS NULL OR first_name = '' OR last_name IS NULL);
  END IF;
END $$;

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
  ADD COLUMN IF NOT EXISTS entry_date DATE,
  ADD COLUMN IF NOT EXISTS labor_classification_id INTEGER;

ALTER TABLE time_entries
  ALTER COLUMN entry_date DROP NOT NULL;

ALTER TABLE time_entries
  DROP CONSTRAINT IF EXISTS time_entries_labor_classification_id_fkey;

ALTER TABLE time_entries
  ADD CONSTRAINT time_entries_labor_classification_id_fkey
    FOREIGN KEY (labor_classification_id)
    REFERENCES labor_classifications(id)
    ON DELETE SET NULL;

DO $$
DECLARE
  existing_rows INTEGER := 0;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'wh347_supplements'
  ) THEN
    EXECUTE 'SELECT COUNT(*) FROM wh347_supplements' INTO existing_rows;
    IF existing_rows > 0 THEN
      RAISE EXCEPTION 'wh347_supplements contains % rows; refusing destructive recreation', existing_rows;
    END IF;
    EXECUTE 'DROP TABLE wh347_supplements CASCADE';
  END IF;
END $$;

CREATE TABLE wh347_supplements (
  id                    SERIAL PRIMARY KEY,
  worker_id             UUID REFERENCES workers(id),
  job_site_id           UUID REFERENCES job_sites(id),
  week_ending_date      DATE NOT NULL,
  paychex_worker_number VARCHAR(10),
  wage_determination_no VARCHAR(100),
  fringe_benefit_credit NUMERIC(10,2),
  fringe_paid_in_lieu   NUMERIC(10,2),
  gross_earned_all_work NUMERIC(10,2),
  deduction_withholding NUMERIC(10,2),
  deduction_fica        NUMERIC(10,2),
  deduction_other       NUMERIC(10,2),
  deduction_other_label VARCHAR(100),
  net_pay               NUMERIC(10,2),
  UNIQUE(worker_id, job_site_id, week_ending_date)
);

CREATE TABLE IF NOT EXISTS company_settings (
  id                        SERIAL PRIMARY KEY,
  company_name              VARCHAR(255),
  company_address           TEXT,
  certifying_official_name  VARCHAR(255),
  certifying_official_title VARCHAR(255),
  phone                     VARCHAR(30),
  email                     VARCHAR(255)
);

INSERT INTO company_settings (company_name, company_address, certifying_official_name, certifying_official_title, phone, email)
SELECT NULL, NULL, NULL, NULL, NULL, NULL
WHERE NOT EXISTS (
  SELECT 1 FROM company_settings
);
