export type StorageKind = "remote_api" | "local_mount";
export type StorageAuthMethod = "none" | "bearer" | "basic" | "api_key";

export interface StorageUsage { total_bytes: number; used_bytes: number; available_bytes: number; percent_used: number; source: string; }

export interface StorageIntegration {
  id: number;
  name: string;
  kind: string;
  endpoint: string;
  base_path: string | null;
  bucket: string | null;
  region: string | null;
  auth_method: string;
  enabled: boolean;
  last_status: string;
  last_error: string | null;
  last_checked_at: string | null;
  created_at: string;
  updated_at: string;
  connection?: string;
  probe?: StorageProbe;
}

export interface StorageServer extends StorageIntegration { usage: StorageUsage | null; }

export interface CameraStorage {
  id: number;
  name: string;
  status: string;
  protocol: string;
  owner: string | null;
  used_bytes: number;
  available_bytes: number;
  percent_used: number;
  recording_count: number;
}

export interface StorageRecording {
  id: string;
  camera_id: number | null;
  name: string;
  path: string;
  size_bytes: number;
  created_at: string | null;
  duration_seconds: number | null;
  mime_type: string;
  server_id: number;
  server_name: string;
  fileUrl: string;
  downloadUrl: string;
}

export interface StorageOverview {
  local: StorageUsage;
  servers: StorageServer[];
  cameras: CameraStorage[];
  recordings: StorageRecording[];
  totals: StorageUsage;
  camera_count: number;
}

export interface StorageIntegrationInput {
  name: string;
  kind: StorageKind;
  endpoint: string;
  base_path?: string;
  bucket?: string;
  region?: string;
  auth_method: StorageAuthMethod;
  secret?: string;
  api_key?: string;
  enabled: boolean;
}

export interface StorageProbe {
  status: string;
  message: string;
  usage: StorageUsage | null;
  cameras: { camera_id: number; used_bytes: number; status?: string }[];
  checked_at: string;
}
