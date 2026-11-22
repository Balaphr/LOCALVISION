ALTER TABLE camera_recordings ADD COLUMN review_status TEXT NOT NULL DEFAULT 'unreviewed';
ALTER TABLE camera_recordings ADD COLUMN reviewed_by TEXT;
ALTER TABLE camera_recordings ADD COLUMN reviewed_at TEXT;

CREATE TABLE IF NOT EXISTS recording_review_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recording_id INTEGER,
  camera_id INTEGER,
  storage_recording_id TEXT,
  previous_status TEXT,
  review_status TEXT NOT NULL,
  reviewed_by TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS person_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  camera_id INTEGER NOT NULL,
  session_key TEXT NOT NULL,
  object_name TEXT NOT NULL DEFAULT 'person',
  entry_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  exit_at TEXT,
  duration_seconds REAL,
  status TEXT NOT NULL DEFAULT 'active',
  activity TEXT,
  snapshot_path TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_person_sessions_key ON person_sessions(camera_id, session_key);
CREATE INDEX IF NOT EXISTS idx_person_sessions_camera_status ON person_sessions(camera_id, status, entry_at DESC);
CREATE INDEX IF NOT EXISTS idx_recording_review_history_recording ON recording_review_history(recording_id, created_at DESC);
