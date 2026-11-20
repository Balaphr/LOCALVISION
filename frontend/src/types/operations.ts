export interface EventItem {
  id: number;
  camera_id?: number | null;
  kind: string;
  object_name?: string | null;
  confidence?: number | null;
  occurred_at: string;
  snapshot_path?: string | null;
  snapshot_url?: string | null;
  clip_path?: string | null;
  clip_url?: string | null;
  description?: string | null;
  track_id?: string | null;
  recording_id?: number | null;
  bounding_box?: Record<string, number> | null;
  duration_seconds?: number | null;
}

export interface Metrics {
  api: string;
  media: string;
  recording: string;
  ai: string;
  cpu?: number | null;
  ram?: number | null;
  gpu?: number | null;
  network?: string | null;
  host: string;
  storage: { total_bytes: number; used_bytes: number; free_bytes: number; low?: boolean };
}

export interface Integration {
  id: number;
  name: string;
  kind: string;
  endpoint: string;
  auth_method: string;
  enabled: boolean;
  created_at: string;
}

export interface IntegrationInput {
  name: string;
  kind: string;
  endpoint: string;
  auth_method: string;
  secret?: string;
  enabled: boolean;
}

export interface AlertItem {
  id: number;
  kind: string;
  message: string;
  status: string;
  created_at: string;
}

export interface AiStatus {
  active: string;
  provider: string;
  model: string;
  status: string;
  local_only?: boolean;
  error?: string | null;
}

export interface CameraTestResult {
  camera_id?: number | null;
  status: "reachable" | "unreachable";
  message: string;
  resolution?: string | null;
  fps?: number | null;
  preview?: string | null;
  hints?: string | null;
}

export interface DiscoveryResult {
  ip: string;
  port: number;
  manufacturer?: string | null;
  model?: string | null;
  onvif_endpoint?: string | null;
  rtsp_url?: string | null;
  error?: string | null;
}
