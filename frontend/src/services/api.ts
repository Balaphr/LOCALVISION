import type { Camera, CameraInput, CameraStatus } from "../types/camera";
import type { RecordingPage, Zone, ZoneInput } from "../types/recording";
import type { AiStatus, AlertItem, DiscoveryResult, EventItem, Integration, IntegrationInput, Metrics } from "../types/operations";
import type { LoginResponse, Role, Share, User, UserRecord } from "../types/auth";
import type { StorageIntegration, StorageIntegrationInput, StorageOverview, StorageProbe, StorageRecording } from "../types/storage";

const request = async <T>(path: string, options?: RequestInit): Promise<T> => {
  const headers = new Headers(options?.headers);
  if (!(options?.body instanceof FormData) && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(path, { ...options, headers, credentials: "include" });
  if (!response.ok) {
    const detail = (await response.json().catch(() => null))?.detail;
    if (response.status === 502 && !detail) throw new Error("LocalVision API is unavailable. Start the FastAPI backend on port 8000, then try again.");
    throw new Error(typeof detail === "string" ? detail : detail ? JSON.stringify(detail) : `Request failed (${response.status})`);
  }
  return response.status === 204 ? (undefined as T) : response.json();
};

const queryString = (filters: object) =>
  new URLSearchParams(Object.entries(filters).filter(([, value]) => value !== undefined && value !== "").map(([key, value]) => [key, String(value)])).toString();

export const cameraApi = {
  list: () => request<Camera[]>("/api/cameras"),
  create: (input: CameraInput) => request<Camera>("/api/cameras", { method: "POST", body: JSON.stringify(input) }),
  discover: () => request<DiscoveryResult[]>("/api/cameras/discover", { method: "POST" }),
  inspectOnvif: (endpoint: string, username?: string, password?: string) => request<DiscoveryResult>("/api/cameras/onvif/inspect", { method: "POST", body: JSON.stringify({ endpoint, username: username || null, password: password || null }) }),
  update: (id: number, input: Partial<CameraInput>) => request<Camera>(`/api/cameras/${id}`, { method: "PUT", body: JSON.stringify(input) }),
  remove: (id: number) => request<void>(`/api/cameras/${id}`, { method: "DELETE" }),
  status: (id: number) => request<CameraStatus>(`/api/cameras/${id}/status`),
  test: (id: number) => request<{ camera_id: number; status: string; message?: string; resolution?: string | null; fps?: number | null }>(`/api/cameras/${id}/test`, { method: "POST" }),
  snapshot: async (id: number) => {
    const response = await fetch(`/api/cameras/${id}/snapshot`, { credentials: "include" });
    if (!response.ok) {
      const detail = (await response.json().catch(() => null))?.detail;
      throw new Error(typeof detail === "string" ? detail : `Snapshot failed (${response.status})`);
    }
    const blob = await response.blob();
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = `camera-${id}-${Date.now()}.jpg`;
    link.click();
    URL.revokeObjectURL(href);
    return { status: "saved" as const };
  },
  previewUrl: (id: number) => `/api/cameras/${id}/preview.jpg?t=${Date.now()}`,
  streamUrl: (id: number) => `/api/cameras/${id}/stream.m3u8`,
  mjpegUrl: (id: number) => `/api/cameras/${id}/stream.mjpeg`,
  recordStart: (id: number) => request<{ status: string; message?: string }>(`/api/cameras/${id}/recording/start`, { method: "POST" }),
  recordStop: (id: number) => request<{ status: string; message?: string }>(`/api/cameras/${id}/recording/stop`, { method: "POST" }),
  recordStatus: (id: number) => request<{ camera_id: number; status: string; last_error?: string | null; last_recording_at?: string | null; desired?: boolean }>(`/api/cameras/${id}/recording/status`),
  mediaUrl: (path: string) => `/api/media/file/${path}`
};

export const recordingApi = {
  list: (filters: { camera_id?: number; date?: string }) => request<RecordingPage>(`/api/recordings?${queryString(filters)}`),
  fileUrl: (id: number) => `/api/recordings/${id}/file`,
  remove: (id: number) => request<void>(`/api/recordings/${id}`, { method: "DELETE" })
};

export const zoneApi = {
  list: (cameraId: number) => request<Zone[]>(`/api/cameras/${cameraId}/zones`),
  create: (cameraId: number, input: ZoneInput) => request<Zone>(`/api/cameras/${cameraId}/zones`, { method: "POST", body: JSON.stringify(input) }),
  remove: (cameraId: number, zoneId: number) => request<void>(`/api/cameras/${cameraId}/zones/${zoneId}`, { method: "DELETE" })
};

export interface EventFilters {
  camera_id?: number;
  search?: string;
  object_name?: string;
  kind?: string;
  start?: string;
  end?: string;
  min_confidence?: number;
  page?: number;
  page_size?: number;
}

export const operationsApi = {
  events: (filters: EventFilters = {}) => request<{ items: EventItem[]; page: number; page_size: number }>(`/api/events?${queryString(filters)}`),
  detections: (filters: EventFilters = {}) => request<{ items: EventItem[]; page: number; page_size: number }>(`/api/detections?${queryString(filters)}`),
  alerts: () => request<AlertItem[]>("/api/alerts"),
  acknowledgeAlert: (id: number) => request<AlertItem>(`/api/alerts/${id}`, { method: "PATCH" }),
  metrics: () => request<Metrics>("/api/metrics"),
  ai: () => request<AiStatus>("/api/ai"),
  surveillance: () => request<{ running: boolean; detector: AiStatus; cameras: Record<string, { status: string; message?: string | null }> }>("/api/surveillance/status")
};

export const monitoringApi = { metrics: () => request<Metrics>("/api/metrics") };

export const integrationApi = {
  list: () => request<Integration[]>("/api/integrations"),
  create: (input: IntegrationInput) => request<Integration>("/api/integrations", { method: "POST", body: JSON.stringify(input) }),
  remove: (id: number) => request<void>(`/api/integrations/${id}`, { method: "DELETE" }),
  test: (id: number) => request<{ ok: boolean; status_code?: number | null; error?: string | null }>(`/api/integrations/${id}/test`, { method: "POST" })
};

export const authApi = {
  login: (username: string, password: string, rememberMe: boolean) => request<LoginResponse>("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password, remember_me: rememberMe }) }),
  guest: () => request<LoginResponse>("/api/auth/guest", { method: "POST" }),
  me: () => request<User>("/api/auth/me"),
  logout: () => request<void>("/api/auth/logout", { method: "POST" }),
  changePassword: (currentPassword: string, newPassword: string) => request<void>("/api/auth/password", { method: "POST", body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }) })
};

export interface UserInput { username: string; password?: string; role: Role; permissions?: Record<string, boolean>; is_active: boolean; }

export const userApi = {
  list: () => request<UserRecord[]>("/api/users"),
  create: (input: UserInput) => request<UserRecord>("/api/users", { method: "POST", body: JSON.stringify(input) }),
  update: (id: number, input: Partial<UserInput>) => request<UserRecord>(`/api/users/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
  remove: (id: number) => request<void>(`/api/users/${id}`, { method: "DELETE" }),
  revokeSessions: (id: number) => request<void>(`/api/users/${id}/sessions/revoke`, { method: "POST" })
};

export const storageApi = {
  overview: () => request<StorageOverview>("/api/storage/overview"),
  list: () => request<StorageIntegration[]>("/api/storage/servers"),
  create: (input: StorageIntegrationInput) => request<StorageIntegration>("/api/storage/servers", { method: "POST", body: JSON.stringify(input) }),
  update: (id: number, input: Partial<StorageIntegrationInput>) => request<StorageIntegration>(`/api/storage/servers/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
  remove: (id: number) => request<void>(`/api/storage/servers/${id}`, { method: "DELETE" }),
  test: (id: number) => request<StorageProbe>(`/api/storage/servers/${id}/test`, { method: "POST" }),
  recordings: (id: number) => request<StorageRecording[]>(`/api/storage/servers/${id}/recordings`),
  upload: (id: number, formData: FormData) => request<StorageRecording>(`/api/storage/servers/${id}/upload`, { method: "POST", body: formData })
};

export const settingsApi = { get: () => request<{ version: string; environment: string; storage_path: string; secrets_configured: boolean }>("/api/settings") };

export const sharingApi = {
  list: (cameraId: number) => request<Share[]>(`/api/cameras/${cameraId}/shares`),
  create: (cameraId: number, input: { username: string; permission: "viewer" | "operator" }) => request<Share>(`/api/cameras/${cameraId}/shares`, { method: "POST", body: JSON.stringify(input) }),
  remove: (cameraId: number, shareId: number) => request<void>(`/api/cameras/${cameraId}/shares/${shareId}`, { method: "DELETE" })
};
