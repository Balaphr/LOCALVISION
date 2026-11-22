ALTER TABLE sessions ADD COLUMN last_seen_at TEXT;

ALTER TABLE cameras ADD COLUMN user_id INTEGER;

ALTER TABLE audit_logs ADD COLUMN camera_id INTEGER;

CREATE TABLE IF NOT EXISTS user_sessions_history (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  username TEXT,
  login_at TEXT NOT NULL,
  last_seen_at TEXT,
  logout_at TEXT,
  end_reason TEXT,
  expires_at TEXT,
  ip TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_history_user_id ON user_sessions_history(user_id, login_at DESC);

CREATE INDEX IF NOT EXISTS idx_cameras_user_id ON cameras(user_id);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_camera_id ON audit_logs(camera_id, created_at DESC);

INSERT OR IGNORE INTO user_sessions_history (id, user_id, username, login_at, last_seen_at, expires_at, ip, user_agent, created_at)
SELECT s.id, s.user_id, u.username, s.created_at, s.last_seen_at, s.expires_at, '', '', s.created_at
FROM sessions s
LEFT JOIN users u ON u.id = s.user_id;

UPDATE cameras
SET user_id = COALESCE(
  (SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1),
  (SELECT id FROM users ORDER BY id LIMIT 1)
)
WHERE user_id IS NULL;
