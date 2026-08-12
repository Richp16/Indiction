-- Up migration:
CREATE TABLE IF NOT EXISTS edit_locks (
  scope_key         TEXT PRIMARY KEY,
  holder_user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  holder_name       TEXT,
  holder_email      TEXT,
  acquired_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_edit_locks_holder
  ON edit_locks (holder_user_id);

CREATE INDEX IF NOT EXISTS idx_edit_locks_heartbeat
  ON edit_locks (last_heartbeat_at);

-- Down migration:
-- DROP TABLE IF EXISTS edit_locks;
