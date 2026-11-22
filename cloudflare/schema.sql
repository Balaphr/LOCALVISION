CREATE TABLE IF NOT EXISTS roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer',
  permissions TEXT NOT NULL DEFAULT '{}',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

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

CREATE TABLE IF NOT EXISTS cameras (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT '',
  manufacturer TEXT NOT NULL DEFAULT 'Generic',
  model TEXT NOT NULL DEFAULT '',
  host TEXT NOT NULL,
  port INTEGER NOT NULL DEFAULT 554,
  protocol TEXT NOT NULL DEFAULT 'RTSP',
  rtsp_url TEXT,
  onvif_url TEXT,
  username TEXT,
  password_enc TEXT,
  main_stream TEXT,
  sub_stream TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  recording_enabled INTEGER NOT NULL DEFAULT 1,
  ai_enabled INTEGER NOT NULL DEFAULT 1,
  import_endpoint TEXT,
  external_id TEXT,
  user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cameras_import_route ON cameras(import_endpoint, external_id);

CREATE INDEX IF NOT EXISTS idx_cameras_user_id ON cameras(user_id);

CREATE TABLE IF NOT EXISTS zones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  camera_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  zone_type TEXT NOT NULL DEFAULT 'detection',
  points TEXT NOT NULL DEFAULT '[]',
  enabled INTEGER NOT NULL DEFAULT 1,
  object_filters TEXT NOT NULL DEFAULT '[]',
  confidence_threshold REAL NOT NULL DEFAULT 0.5,
  direction TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (camera_id) REFERENCES cameras(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS shares (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  camera_id INTEGER NOT NULL,
  username TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer',
  permission TEXT NOT NULL DEFAULT 'viewer',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (camera_id) REFERENCES cameras(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS integrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  endpoint TEXT NOT NULL DEFAULT '',
  auth_method TEXT NOT NULL DEFAULT 'none',
  secret_enc TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS storage_servers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'local_mount',
  endpoint TEXT NOT NULL DEFAULT '',
  base_path TEXT,
  bucket TEXT,
  region TEXT,
  auth_method TEXT NOT NULL DEFAULT 'none',
  secret_enc TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_status TEXT NOT NULL DEFAULT 'unknown',
  last_error TEXT,
  last_checked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS camera_recordings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  camera_id INTEGER NOT NULL,
  storage_server_id INTEGER,
  storage_recording_id TEXT,
  name TEXT NOT NULL,
  camera TEXT NOT NULL,
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  filename TEXT NOT NULL,
  duration_seconds REAL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ready',
  started_at TEXT NOT NULL,
  ended_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (camera_id) REFERENCES cameras(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_camera_recordings_storage_id ON camera_recordings(storage_recording_id);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  camera_id INTEGER,
  kind TEXT NOT NULL DEFAULT 'motion',
  object_name TEXT,
  confidence REAL,
  occurred_at TEXT NOT NULL DEFAULT (datetime('now')),
  snapshot_path TEXT,
  snapshot_url TEXT,
  clip_path TEXT,
  clip_url TEXT,
  description TEXT,
  track_id TEXT,
  recording_id INTEGER,
  bounding_box TEXT,
  duration_seconds REAL
);

CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  camera_id INTEGER,
  kind TEXT NOT NULL DEFAULT 'system',
  message TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'warning',
  status TEXT NOT NULL DEFAULT 'new',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

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

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  username TEXT,
  action TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT '',
  camera_id INTEGER,
  ip TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_camera_id ON audit_logs(camera_id, created_at DESC);
