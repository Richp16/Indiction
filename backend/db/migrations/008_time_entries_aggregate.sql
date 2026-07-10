-- Migration 008: Convert time_entries to aggregated Paychex submission table.
-- Rebuilds from daily_time_entries (canonical per-day source).

DROP TABLE IF EXISTS time_entries_aggregated;

CREATE TABLE time_entries_aggregated (
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
  CONSTRAINT time_entries_agg_unique
    UNIQUE (worker_id, job_site_id, pay_period_id, paychex_component_id)
);

INSERT INTO time_entries_aggregated (
  worker_id,
  job_site_id,
  pay_period_id,
  pay_period_end_date,
  paychex_component_id,
  component_name,
  component_rate,
  hours,
  reimbursement_amount,
  labor_classification_id,
  entered_by,
  created_at,
  updated_at
)
SELECT
  d.worker_id,
  d.job_site_id,
  d.pay_period_id,
  d.pay_period_end_date,
  CASE d.pay_code
    WHEN 'REGULAR' THEN 'HOURLY'
    WHEN 'OT' THEN 'OVERTIME'
    WHEN 'DT' THEN 'DOUBLETIME'
    ELSE d.paychex_component_id
  END,
  MAX(d.component_name),
  MAX(d.component_rate),
  SUM(d.hours_worked),
  SUM(d.reimbursement_amount),
  MAX(d.labor_classification_id),
  (array_agg(d.entered_by ORDER BY d.created_at DESC))[1],
  MIN(d.created_at),
  MAX(d.created_at)
FROM daily_time_entries d
GROUP BY
  d.worker_id,
  d.job_site_id,
  d.pay_period_id,
  d.pay_period_end_date,
  CASE d.pay_code
    WHEN 'REGULAR' THEN 'HOURLY'
    WHEN 'OT' THEN 'OVERTIME'
    WHEN 'DT' THEN 'DOUBLETIME'
    ELSE d.paychex_component_id
  END;

DROP TABLE IF EXISTS time_entries;
ALTER TABLE time_entries_aggregated RENAME TO time_entries;

-- Down migration:
-- (Requires restoring per-day rows from daily_time_entries; not automated.)
