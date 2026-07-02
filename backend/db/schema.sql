CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('superintendent', 'payroll_admin', 'system_admin')),
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workers (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  paychex_worker_id   TEXT UNIQUE NOT NULL,
  employee_code       TEXT,
  first_name          TEXT NOT NULL,
  last_name           TEXT NOT NULL,
  worker_type         TEXT DEFAULT 'EMPLOYEE',
  exemption_type      TEXT DEFAULT 'NON_EXEMPT',
  is_active           BOOLEAN DEFAULT true,
  last_synced_at      TIMESTAMPTZ
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

CREATE TABLE IF NOT EXISTS job_sites (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  paychex_job_id   TEXT UNIQUE NOT NULL,
  name             TEXT NOT NULL,
  is_active        BOOLEAN DEFAULT true,
  last_synced_at   TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS pay_periods (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  paychex_period_id   TEXT UNIQUE NOT NULL,
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

CREATE TABLE IF NOT EXISTS time_entries (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id                UUID REFERENCES workers(id),
  job_site_id              UUID REFERENCES job_sites(id),
  pay_period_id            UUID REFERENCES pay_periods(id),
  paychex_component_id     TEXT NOT NULL,
  component_name           TEXT NOT NULL,
  component_rate           NUMERIC(10,2),
  hours                    NUMERIC(5,2) NOT NULL,
  reimbursement_amount     NUMERIC(10,2) DEFAULT 0,
  entry_date               DATE NOT NULL,
  week_number              INTEGER CHECK (week_number IN (1, 2)),
  entered_by               UUID REFERENCES users(id),
  created_at               TIMESTAMPTZ DEFAULT now(),
  UNIQUE(worker_id, job_site_id, paychex_component_id, entry_date)
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
