ALTER TABLE alerts ADD COLUMN camera_id INTEGER;
ALTER TABLE alerts ADD COLUMN severity TEXT NOT NULL DEFAULT 'warning';
ALTER TABLE alerts ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now'));

CREATE TABLE IF NOT EXISTS ai_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  camera_id INTEGER,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_alerts_camera_id ON alerts(camera_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_settings_camera_id ON ai_settings(camera_id, key);
CREATE INDEX IF NOT EXISTS idx_events_camera_id ON events(camera_id, occurred_at DESC);
