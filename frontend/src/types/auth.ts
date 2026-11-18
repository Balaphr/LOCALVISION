export interface User { id: number; username: string; role: "admin" | "operator" | "viewer"; }
export interface LoginResponse { user: User; authenticated: boolean; }
export interface Share { id: number; camera_id: number; username: string; role: string; permission: string; created_at: string; }
