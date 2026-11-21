export type Protocol = "RTSP" | "ONVIF" | "HTTP" | "MJPEG" | "Other";

export interface Camera {
  id: number;
  name: string;
  location: string;
  manufacturer: string;
  model: string;
  host: string;
  port: number;
  protocol: Protocol;
  rtsp_url?: string | null;
  onvif_url?: string | null;
  username?: string | null;
  main_stream?: string | null;
  sub_stream?: string | null;
  enabled: boolean;
  recording_enabled: boolean;
  ai_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export type CameraInput = Omit<Camera, "id" | "created_at" | "updated_at"> & { password?: string };

export interface CameraStatus {
  camera_id: number;
  status: string;
  message?: string | null;
  resolution?: string | null;
  fps?: number | null;
  stream?: string;
  recording?: string;
  last_frame_at?: string | null;
  last_error?: string | null;
  restarts?: number;
  restart_count?: number;
  protocol?: string;
}
