import type { Recording } from "./recording";

export interface MonitoringFilters {
  username: string;
  date: string;
  session_state: string;
  camera_state: string;
  recording_state: string;
}

export interface MonitoringSummary {
  accounts: number;
  online_users: number;
  active_sessions: number;
  cameras: number;
  online_cameras: number;
  recording_cameras: number;
  recordings_total: number;
  recordings_today: number;
  recorded_bytes: number;
}

export interface MonitoringBridge {
  status: string;
  config_loaded_at: string | null;
  config_error: string | null;
  error: string | null;
}

export interface MonitoringStorageServer {
  id: number;
  name: string;
  kind: string;
  endpoint: string;
  enabled: boolean;
  last_status: string;
  last_error: string | null;
  last_checked_at: string | null;
}

export interface MonitoringUser {
  id: number;
  username: string;
  role: string;
  is_active: boolean;
  created_at: string;
  first_login_at: string | null;
  last_seen_at: string | null;
  online: boolean;
  active_sessions: number;
  camera_count: number;
  online_cameras: number;
  recording_cameras: number;
  recording_count: number;
  audit_count: number;
}

export interface MonitoringCamera {
  id: number;
  name: string;
  location: string;
  protocol: string;
  host: string;
  enabled: boolean;
  user_id: number | null;
  owner: string;
  stream_state: string;
  recording_state: string;
  stream_status: string | null;
  recording_status: string | null;
  last_error: string | null;
  last_recording_at: string | null;
  recording_count: number;
  recorded_bytes: number;
  created_at: string;
}

export interface MonitoringSession {
  id: string;
  user_id: number;
  username: string | null;
  login_at: string;
  last_seen_at: string | null;
  logout_at: string | null;
  end_reason: string | null;
  expires_at: string | null;
  ip: string;
  user_agent: string;
  active: boolean;
  online: boolean;
}

export interface MonitoringActivity {
  id: number;
  user_id: number | null;
  username: string | null;
  action: string;
  target: string;
  camera_id: number | null;
  ip: string;
  created_at: string;
}

export interface MonitoringRecording extends Recording {
  owner: string;
  stream_state: string;
  recording_state: string;
}

export interface MonitoringOverview {
  generated_at: string;
  filters: MonitoringFilters;
  summary: MonitoringSummary;
  bridge: MonitoringBridge;
  storage: { recorded_bytes: number; servers: MonitoringStorageServer[] };
  users: MonitoringUser[];
  cameras: MonitoringCamera[];
  sessions: MonitoringSession[];
  activity: MonitoringActivity[];
  recordings: MonitoringRecording[];
}

export interface MonitoringEvent {
  id: number;
  camera_id: number | null;
  kind: string;
  object_name: string | null;
  occurred_at: string;
  description: string | null;
}

export interface MonitoringUserDetail {
  user: { id: number; username: string; role: string; is_active: boolean; created_at: string };
  summary: {
    first_login_at: string | null;
    last_seen_at: string | null;
    active_sessions: number;
    total_sessions: number;
    cameras: number;
    recordings: number;
    events: number;
    audit_actions: number;
  };
  sessions: MonitoringSession[];
  activity: MonitoringActivity[];
  cameras: Array<{ id: number; name: string; location: string; host: string; enabled: boolean; created_at: string }>;
  recordings: Recording[];
  events: MonitoringEvent[];
}
