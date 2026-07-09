-- One-time backfill: ensure all workers have a valid worker_type defaulting to 'J'
ALTER TABLE workers
  ALTER COLUMN worker_type SET DEFAULT 'J';

UPDATE workers
SET worker_type = 'J'
WHERE worker_type IS NULL
   OR worker_type NOT IN ('J', 'RA');
