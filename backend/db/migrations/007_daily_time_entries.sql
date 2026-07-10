-- Migration 007: Normalize daily_time_entries to UUID worker/job-site FKs
-- and add columns required for certified payroll + Paychex dual-write.

-- Legacy table (employee_id integer) -> rebuild with worker_id UUID.
ALTER TABLE IF EXISTS daily_time_entries RENAME TO daily_time_entries_legacy;

CREATE TABLE daily_time_entries (
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
  CONSTRAINT daily_time_entries_worker_job_date_component_unique
    UNIQUE (worker_id, job_site_id, date_worked, paychex_component_id)
);

CREATE INDEX idx_daily_time_entries_job_period
  ON daily_time_entries (job_site_id, pay_period_end_date);

CREATE INDEX idx_daily_time_entries_date_worked
  ON daily_time_entries (date_worked);

-- Migrate legacy rows (employee_id was internal employee_code).
INSERT INTO daily_time_entries (
  worker_id,
  job_site_id,
  date_worked,
  hours_worked,
  regular_hours,
  overtime_hours,
  doubletime_hours,
  pay_period_id,
  pay_period_end_date,
  pay_code,
  paychex_component_id,
  component_name,
  component_rate,
  reimbursement_amount,
  week_number
)
SELECT
  w.id,
  l.job_site_id,
  l.date_worked::date,
  l.hours_worked,
  COALESCE(l.regular_hours, 0),
  COALESCE(l.overtime_hours, 0),
  0,
  pp.id,
  l.pay_period_end_date::date,
  CASE
    WHEN COALESCE(l.overtime_hours, 0) > 0 AND COALESCE(l.regular_hours, 0) = 0 THEN 'OT'
    ELSE 'REGULAR'
  END,
  CASE
    WHEN COALESCE(l.overtime_hours, 0) > 0 AND COALESCE(l.regular_hours, 0) = 0 THEN 'OT'
    ELSE 'REGULAR'
  END,
  CASE
    WHEN COALESCE(l.overtime_hours, 0) > 0 AND COALESCE(l.regular_hours, 0) = 0 THEN 'Overtime'
    ELSE 'Regular Hours'
  END,
  w.standard_rate,
  0,
  CASE
    WHEN l.date_worked::date BETWEEN pp.week1_start AND pp.week1_end THEN 1
    WHEN l.date_worked::date BETWEEN pp.week2_start AND pp.week2_end THEN 2
    ELSE NULL
  END
FROM daily_time_entries_legacy l
JOIN workers w ON w.employee_code = l.employee_id::text
JOIN pay_periods pp ON pp.end_date = l.pay_period_end_date::date
ON CONFLICT (worker_id, job_site_id, date_worked, paychex_component_id) DO NOTHING;

-- Backfill any per-day rows still in time_entries (if entry_date column exists).
INSERT INTO daily_time_entries (
  worker_id,
  job_site_id,
  date_worked,
  hours_worked,
  regular_hours,
  overtime_hours,
  doubletime_hours,
  pay_period_id,
  pay_period_end_date,
  pay_code,
  paychex_component_id,
  component_name,
  component_rate,
  reimbursement_amount,
  labor_classification_id,
  week_number,
  entered_by,
  created_at
)
SELECT
  te.worker_id,
  te.job_site_id,
  te.entry_date,
  te.hours,
  CASE
    WHEN te.paychex_component_id IN ('REGULAR', 'HOURLY', 'Hourly', 'Regular') THEN te.hours
    ELSE 0
  END,
  CASE
    WHEN te.paychex_component_id IN ('OT', 'OVERTIME', 'Overtime') THEN te.hours
    ELSE 0
  END,
  CASE
    WHEN te.paychex_component_id IN ('DT', 'DOUBLETIME', 'Doubletime') THEN te.hours
    ELSE 0
  END,
  te.pay_period_id,
  pp.end_date,
  te.paychex_component_id,
  te.paychex_component_id,
  te.component_name,
  te.component_rate,
  te.reimbursement_amount,
  te.labor_classification_id,
  te.week_number,
  te.entered_by,
  te.created_at
FROM time_entries te
JOIN pay_periods pp ON te.pay_period_id = pp.id
WHERE te.entry_date IS NOT NULL
ON CONFLICT (worker_id, job_site_id, date_worked, paychex_component_id) DO NOTHING;

DROP TABLE IF EXISTS daily_time_entries_legacy;

-- Down migration:
-- (Restore from backup if needed.)
