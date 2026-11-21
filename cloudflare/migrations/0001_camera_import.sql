ALTER TABLE cameras ADD COLUMN import_endpoint TEXT;
ALTER TABLE cameras ADD COLUMN external_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_cameras_import_route ON cameras(import_endpoint, external_id);
