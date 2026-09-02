CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name          TEXT,
  role          TEXT NOT NULL CHECK (role IN ('superintendent', 'payroll_admin', 'system_admin')),
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS labor_classifications (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(100) NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workers (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  paychex_worker_id       TEXT UNIQUE,
  employee_code           TEXT,
  first_name              TEXT NOT NULL,
  last_name               TEXT NOT NULL,
  worker_type             VARCHAR(2) DEFAULT 'J',
  exemption_type          TEXT DEFAULT 'NON_EXEMPT',
  pay_type                TEXT DEFAULT 'HOURLY',
  standard_rate           NUMERIC(10,2),
  is_active               BOOLEAN DEFAULT true,
  last_synced_at          TIMESTAMPTZ,
  labor_classification_id INTEGER REFERENCES labor_classifications(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS worker_pay_components (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id                UUID REFERENCES workers(id) ON DELETE CASCADE,
  paychex_component_id     TEXT NOT NULL,
  name                     TEXT NOT NULL,
  rate                     NUMERIC(10,2),
  last_synced_at           TIMESTAMPTZ,
  UNIQUE(worker_id, paychex_component_id)
);

CREATE TABLE IF NOT EXISTS worker_recurring_reimbursements (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id                UUID NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  paychex_worker_id        TEXT NOT NULL,
  paychex_pay_component_id TEXT NOT NULL,
  component_name           TEXT,
  amount                   NUMERIC(12,2) NOT NULL,
  recurring                BOOLEAN NOT NULL DEFAULT true,
  last_synced_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (worker_id, paychex_pay_component_id)
);

CREATE TABLE IF NOT EXISTS job_sites (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_code         TEXT UNIQUE NOT NULL,
  name             TEXT NOT NULL,
  address          TEXT,
  contract_number  VARCHAR(100),
  wage_determination_no VARCHAR(100),
  start_date       DATE,
  certified_payroll_count INTEGER DEFAULT 0,
  is_active        BOOLEAN DEFAULT true,
  last_synced_at   TIMESTAMPTZ,
  int_id           INTEGER
);

CREATE TABLE IF NOT EXISTS pay_periods (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  paychex_period_id   TEXT UNIQUE,
  start_date          DATE NOT NULL,
  end_date            DATE NOT NULL,
  submit_by_date      DATE NOT NULL,
  pay_date            DATE NOT NULL,
  status              TEXT DEFAULT 'OPEN',
  week1_start         DATE,
  week1_end           DATE,
  week2_start         DATE,
  week2_end           DATE
);

-- Paychex-discovered periods for /checks (separate from operational pay_periods)
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

CREATE TABLE IF NOT EXISTS worker_job_site_rates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id   UUID NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  job_site_id UUID NOT NULL REFERENCES job_sites(id) ON DELETE CASCADE,
  rate        NUMERIC(10,2) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (worker_id, job_site_id)
);

ALTER TABLE workers
  ADD COLUMN IF NOT EXISTS labor_classification_id INTEGER REFERENCES labor_classifications(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS daily_time_entries (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id             UUID NOT NULL REFERENCES workers(id),
  job_site_id           UUID REFERENCES job_sites(id),
  date_worked           DATE NOT NULL,
  hours_worked          NUMERIC(8,2) NOT NULL,
  regular_hours         NUMERIC(8,2) NOT NULL DEFAULT 0,
  overtime_hours        NUMERIC(8,2) NOT NULL DEFAULT 0,
  doubletime_hours      NUMERIC(8,2) NOT NULL DEFAULT 0,
  pay_period_id         UUID NOT NULL REFERENCES pay_periods(id),
  pay_period_end_date   DATE NOT NULL,
  pay_code              TEXT NOT NULL,
  paychex_component_id  TEXT NOT NULL,
  component_name        TEXT NOT NULL DEFAULT '',
  component_rate        NUMERIC(10,2),
  reimbursement_amount  NUMERIC(10,2) DEFAULT 0,
  labor_classification_id INTEGER REFERENCES labor_classifications(id) ON DELETE SET NULL,
  week_number           INTEGER CHECK (week_number IN (1, 2)),
  entered_by            UUID REFERENCES users(id),
  created_at            TIMESTAMPTZ DEFAULT now(),
  UNIQUE (worker_id, job_site_id, date_worked, paychex_component_id)
);

CREATE TABLE IF NOT EXISTS time_entries (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id                UUID REFERENCES workers(id),
  job_site_id              UUID REFERENCES job_sites(id),
  pay_period_id            UUID REFERENCES pay_periods(id),
  pay_period_end_date      DATE NOT NULL,
  paychex_component_id     TEXT NOT NULL,
  component_name           TEXT NOT NULL,
  component_rate           NUMERIC(10,2),
  hours                    NUMERIC(8,2) NOT NULL DEFAULT 0,
  reimbursement_amount     NUMERIC(10,2) DEFAULT 0,
  labor_classification_id  INTEGER REFERENCES labor_classifications(id) ON DELETE SET NULL,
  entered_by               UUID REFERENCES users(id),
  created_at               TIMESTAMPTZ DEFAULT now(),
  updated_at               TIMESTAMPTZ DEFAULT now(),
  UNIQUE (worker_id, job_site_id, pay_period_id, paychex_component_id)
);

CREATE TABLE IF NOT EXISTS wh347_supplements (
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

CREATE TABLE IF NOT EXISTS company_settings (
  id                        SERIAL PRIMARY KEY,
  company_name              VARCHAR(255),
  company_address           TEXT,
  certifying_official_name  VARCHAR(255),
  certifying_official_title VARCHAR(255),
  phone                     VARCHAR(30),
  email                     VARCHAR(255),
  paychex_enabled           BOOLEAN NOT NULL DEFAULT true,
  integration_configured    BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS submission_log (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pay_period_id        UUID REFERENCES pay_periods(id),
  submitted_by         UUID REFERENCES users(id),
  submitted_at         TIMESTAMPTZ DEFAULT now(),
  status               TEXT,
  paychex_check_id     TEXT,
  worker_id            UUID REFERENCES workers(id),
  error_message        TEXT,
  retry_count          INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sync_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_type   TEXT NOT NULL,
  status      TEXT NOT NULL,
  message     TEXT,
  ran_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS biweekly_raw (
  id                    SERIAL PRIMARY KEY,
  employee_id           INTEGER,
  employee_last_name    TEXT,
  employee_first_name   TEXT,
  pay_period_end_date   DATE,
  date_worked           DATE,
  week_group            INTEGER,
  project               TEXT,
  project_code          TEXT,
  hours_worked          NUMERIC(8,2),
  regular_hours         NUMERIC(8,2),
  overtime_hours        NUMERIC(8,2),
  reimbursement         NUMERIC(10,2)
);

CREATE TABLE IF NOT EXISTS active_edit_lock (
  singleton         SMALLINT PRIMARY KEY DEFAULT 1 CHECK (singleton = 1),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  holder_name       TEXT,
  holder_email      TEXT,
  holder_role       TEXT,
  acquired_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_sessions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_activity_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at        TIMESTAMPTZ,
  closing_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user
  ON user_sessions (user_id);

CREATE INDEX IF NOT EXISTS idx_user_sessions_activity
  ON user_sessions (last_activity_at)
  WHERE revoked_at IS NULL;
