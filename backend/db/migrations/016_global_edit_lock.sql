-- Up migration: replace scoped edit_locks with a singleton global lock.
DROP TABLE IF EXISTS edit_locks;

CREATE TABLE IF NOT EXISTS active_edit_lock (
  singleton         SMALLINT PRIMARY KEY DEFAULT 1 CHECK (singleton = 1),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  holder_name       TEXT,
  holder_email      TEXT,
  holder_role       TEXT,
  acquired_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Down migration:
-- DROP TABLE IF EXISTS active_edit_lock;
-- (scoped edit_locks is not restored)
