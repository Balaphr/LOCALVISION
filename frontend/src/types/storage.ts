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
}

export interface StorageOverview {
  local: StorageUsage;
  servers: StorageServer[];
  cameras: CameraStorage[];
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
  enabled: boolean;
}

export interface StorageProbe { status: string; message: string; usage: StorageUsage | null; checked_at: string; }
