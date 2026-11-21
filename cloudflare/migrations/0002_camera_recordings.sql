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
