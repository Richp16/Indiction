-- Up migration: server-side user sessions for idle timeout / tab-close logout.
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

-- Down migration:
-- DROP TABLE IF EXISTS user_sessions;
