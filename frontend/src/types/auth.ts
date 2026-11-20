export type Role = "admin" | "operator" | "viewer";
export interface User { id: number; username: string; role: Role; permissions?: Record<string, boolean>; is_active?: boolean; }
export interface UserRecord extends User { created_at: string; }
export interface LoginResponse { user: User; authenticated: boolean; }
export interface Share { id: number; camera_id: number; username: string; role: string; permission: string; created_at: string; }
