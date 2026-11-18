export interface Recording { id: number; camera_id: number; path: string; started_at: string; ended_at?: string | null; duration_seconds?: number | null; size_bytes: number; kind: string; status: string; }
export interface RecordingPage { items: Recording[]; page: number; page_size: number; }
export type ZoneType = "detection" | "ignore" | "restricted" | "line";
export interface Zone { id: number; camera_id: number; name: string; zone_type: ZoneType; points: number[][]; enabled: boolean; object_filters: string[]; confidence_threshold: number; direction?: "any" | "a_to_b" | "b_to_a" | null; created_at: string; updated_at: string; }
export type ZoneInput = Omit<Zone, "id" | "camera_id" | "created_at" | "updated_at">;
