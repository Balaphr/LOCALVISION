export interface PersonSession {
  id: number;
  camera_id?: number | null;
  camera_name?: string | null;
  object_name?: string | null;
  entry_at: string;
  last_seen_at?: string | null;
  exit_at?: string | null;
  duration_seconds?: number | null;
  status: string;
  activity?: string | null;
  snapshot_path?: string | null;
  snapshot_url?: string | null;
}

export interface EventItem {
  id: number;
  camera_id?: number | null;
  camera_name?: string | null;
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
  details?: Partial<Record<"api" | "media" | "recording" | "ai" | "storage" | "host", string>>;
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
  camera_id?: number | null;
  camera_name?: string | null;
  kind: string;
  message: string;
  severity: string;
  status: string;
  created_at: string;
  updated_at?: string;
}

export interface AiSettings {
  detection_confidence: number;
  motion_threshold: number;
  frame_interval_ms: number;
  max_objects: number;
  surveillance_enabled: boolean;
  alert_severity: "info" | "warning" | "critical" | "none";
  notify_webhooks: boolean;
  voice_enabled: boolean;
  person_only: boolean;
}

export interface AiSettingsResponse {
  settings: AiSettings;
  rows: Array<{ id: number; camera_id: number | null; key: string; value: unknown; enabled: boolean; updated_at: string }>;
}

export interface AiModel {
  id: string;
  kind?: string;
  endpoint?: string;
}

export interface AiStatus {
  active: string;
  provider: string;
  model: string;
  status: string;
  local_only?: boolean;
  error?: string | null;
  detector?: Record<string, unknown> | null;
  models?: AiModel[];
  cameras?: Record<string, unknown>;
  fps?: number | null;
  last_frame_at?: string | null;
  counts?: { cameras: number; events: number; alerts: number; new_alerts: number };
  recent_events?: EventItem[];
  recent_alerts?: AlertItem[];
}

export interface AiChatResponse {
  answer: string;
  model?: string | null;
}

export interface SharingHistoryItem {
  id: number;
  username?: string | null;
  action: string;
  target: string;
  camera_id?: number | null;
  created_at: string;
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
