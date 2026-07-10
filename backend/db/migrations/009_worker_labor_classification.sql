-- Canonical labor classification per worker (managed in Classifications admin UI).

ALTER TABLE workers
  ADD COLUMN IF NOT EXISTS labor_classification_id INTEGER NULL;

ALTER TABLE workers
  DROP CONSTRAINT IF EXISTS workers_labor_classification_id_fkey;

ALTER TABLE workers
  ADD CONSTRAINT workers_labor_classification_id_fkey
  FOREIGN KEY (labor_classification_id) REFERENCES labor_classifications(id) ON DELETE SET NULL;

-- Down migration:
-- ALTER TABLE workers DROP CONSTRAINT IF EXISTS workers_labor_classification_id_fkey;
-- ALTER TABLE workers DROP COLUMN IF EXISTS labor_classification_id;
