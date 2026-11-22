export interface Recording { id: number; camera_id: number; camera?: string; name?: string; date?: string | null; time?: string | null; path: string; filename?: string; started_at: string; ended_at?: string | null; duration_seconds?: number | null; size_bytes: number; kind: string; status: string; review_status?: string; reviewed_by?: string | null; reviewed_at?: string | null; fileUrl?: string | null; downloadUrl?: string | null; }
export interface RecordingPage { items: Recording[]; page: number; page_size: number; }
export type ZoneType = "detection" | "ignore" | "restricted" | "line";
export interface Zone { id: number; camera_id: number; name: string; zone_type: ZoneType; points: number[][]; enabled: boolean; object_filters: string[]; confidence_threshold: number; direction?: "any" | "a_to_b" | "b_to_a" | null; created_at: string; updated_at: string; }
export type ZoneInput = Omit<Zone, "id" | "camera_id" | "created_at" | "updated_at">;
