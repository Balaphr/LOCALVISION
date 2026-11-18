import type { Camera, CameraInput } from "../types/camera";
import type { RecordingPage, Zone, ZoneInput } from "../types/recording";
import type { AlertItem, EventItem, Integration, Metrics } from "../types/operations";
import type { LoginResponse, Share, User } from "../types/auth";

const request = async <T>(path: string, options?: RequestInit): Promise<T> => {
  const response = await fetch(path, { headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) }, credentials: "include", ...options });
  if (!response.ok) {
    const detail = (await response.json().catch(() => null))?.detail;
    if (response.status === 502) throw new Error("LocalVision API is unavailable. Start the FastAPI backend on port 8000, then try again.");
    throw new Error(detail ?? `Request failed (${response.status})`);
  }
  return response.status === 204 ? (undefined as T) : response.json();
};

export const cameraApi = {
  list: () => request<Camera[]>("/api/cameras"),
  create: (input: CameraInput) => request<Camera>("/api/cameras", { method: "POST", body: JSON.stringify(input) }),
  importFromApi: (endpoint: string, apiKey: string) => request<{ imported: number; skipped: number }>("/api/cameras/import", { method: "POST", body: JSON.stringify({ endpoint, api_key: apiKey }) }),
  update: (id: number, input: Partial<CameraInput>) => request<Camera>(`/api/cameras/${id}`, { method: "PUT", body: JSON.stringify(input) }),
  remove: (id: number) => request<void>(`/api/cameras/${id}`, { method: "DELETE" }),
  test: (id: number) => request<{ status: string; message: string }>(`/api/cameras/${id}/test`, { method: "POST" }),
  snapshot: (id: number) => request<{ status: string; path?: string; message?: string }>(`/api/cameras/${id}/snapshot`)
};

export const recordingApi = {
  list: (filters: { camera_id?: number; date?: string }) => request<RecordingPage>(`/api/recordings?${new URLSearchParams(Object.entries(filters).filter((entry): entry is [string, string] => entry[1] !== undefined).map(([key, value]) => [key, String(value)]))}`),
  fileUrl: (id: number) => `/api/recordings/${id}/file`,
  remove: (id: number) => request<void>(`/api/recordings/${id}`, { method: "DELETE" })
};

export const zoneApi = {
  list: (cameraId: number) => request<Zone[]>(`/api/cameras/${cameraId}/zones`),
  create: (cameraId: number, input: ZoneInput) => request<Zone>(`/api/cameras/${cameraId}/zones`, { method: "POST", body: JSON.stringify(input) }),
  remove: (cameraId: number, zoneId: number) => request<void>(`/api/cameras/${cameraId}/zones/${zoneId}`, { method: "DELETE" })
};

export const operationsApi = {
  events: () => request<{ items: EventItem[] }>("/api/events"),
  alerts: () => request<AlertItem[]>("/api/alerts"),
  metrics: () => request<Metrics>("/api/metrics"),
  ai: () => request<{ provider: string; model: string; status: string; local_only: boolean }>("/api/ai")
};

export const monitoringApi = { metrics: () => request<Metrics>("/api/metrics") };

export const integrationApi = {
  list: () => request<Integration[]>("/api/integrations"),
  test: (id: number) => request<{ ok: boolean; status_code?: number | null; error?: string | null }>(`/api/integrations/${id}/test`, { method: "POST" })
};

export const authApi = {
  login: (username: string, password: string, rememberMe: boolean) => request<LoginResponse>("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password, remember_me: rememberMe }) }),
  guest: () => request<LoginResponse>("/api/auth/guest", { method: "POST" }),
  me: () => request<User>("/api/auth/me"),
  logout: () => request<void>("/api/auth/logout", { method: "POST" })
};

export const userApi = {
  list: () => request<{ id: number; username: string; role: string }[]>("/api/users"),
  create: (username: string, password: string, role: string) => request<{ id: number; username: string; role: string }>("/api/users", { method: "POST", body: JSON.stringify({ username, password, role }) }),
  remove: (id: number) => request<void>(`/api/users/${id}`, { method: "DELETE" })
};

export const settingsApi = { get: () => request<{ version: string; environment: string; storage_path: string; secrets_configured: boolean }>("/api/settings") };

export const sharingApi = {
  list: (cameraId: number) => request<Share[]>(`/api/cameras/${cameraId}/shares`),
  create: (cameraId: number, input: { username: string; permission: "viewer" | "operator" }) => request<Share>(`/api/cameras/${cameraId}/shares`, { method: "POST", body: JSON.stringify(input) }),
  remove: (cameraId: number, shareId: number) => request<void>(`/api/cameras/${cameraId}/shares/${shareId}`, { method: "DELETE" })
};
