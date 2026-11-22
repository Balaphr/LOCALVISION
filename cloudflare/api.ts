import { all, first, run, parseJson } from "./db";
import { hashPassword, verifyPassword, randomToken, encryptSecret, decryptSecret } from "./crypto";

declare const WebSocketPair: any;

export interface Env {
  DB: any;
  ASSETS?: any;
  ADMIN_USERNAME?: string;
  ADMIN_PASSWORD?: string;
  SESSION_HOURS?: string;
  ALLOW_GUEST_MODE?: string;
  ENCRYPTION_KEY?: string;
  SECRET_KEY?: string;
  MEDIA_BRIDGE_URL?: string;
  MEDIA_BRIDGE_TOKEN?: string;
}

const json = (data: any, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });

const fail = (message: string, status = 400) => json({ detail: message }, status);

const empty = () => new Response(null, { status: 204 });

const stamp = () => new Date().toISOString();

const bodyOf = async (request: Request): Promise<any> => {
  try {
    return (await request.json()) ?? {};
  } catch {
    return {};
  }
};

const parseCookies = (request: Request) => {
  const result: Record<string, string> = {};
  for (const item of (request.headers.get("cookie") || "").split(";")) {
    const index = item.indexOf("=");
    if (index > 0) result[item.slice(0, index).trim()] = decodeURIComponent(item.slice(index + 1).trim());
  }
  return result;
};

const secureAttribute = (request: Request) => (new URL(request.url).protocol === "https:" ? " Secure;" : "");

const sessionCookie = (request: Request, token: string, maxAge?: number) =>
  `localvision_session=${token}; Path=/; HttpOnly; SameSite=Lax;${secureAttribute(request)}${maxAge ? ` Max-Age=${maxAge}` : ""}`;

const clearCookie = (request: Request) =>
  `localvision_session=; Path=/; HttpOnly; SameSite=Lax;${secureAttribute(request)} Max-Age=0`;

const sessionHours = (env: Env) => {
  const value = Number(env.SESSION_HOURS ?? 24);
  return Number.isFinite(value) && value > 0 ? value : 24;
};

const userView = (user: any) => ({
  id: user.id,
  username: user.username,
  role: user.role,
  permissions: parseJson(user.permissions, {}),
  is_active: !!user.is_active,
  created_at: user.created_at
});

const normalizeRtspUrl = (value: any): string => {
  const raw = String(value ?? "").trim();
  const match = raw.match(/^(?:https?:\/\/)?(rtsps?:\/\/\S+)$/i);
  return match ? match[1] : raw;
};

const redactStreamUrl = (value: any): string | null => {
  const raw = normalizeRtspUrl(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.username || url.password) {
      url.username = "";
      url.password = "";
      return url.toString();
    }
  } catch {}
  return raw;
};

const splitCredentials = (value: any) => {
  const raw = normalizeRtspUrl(value);
  if (!/^rtsps?:\/\//i.test(raw)) return { url: raw, username: "", password: "" };
  try {
    const url = new URL(raw);
    const username = decodeURIComponent(url.username);
    const password = decodeURIComponent(url.password);
    if (!username && !password) return { url: raw, username: "", password: "" };
    url.username = "";
    url.password = "";
    return { url: url.toString(), username, password };
  } catch {
    return { url: raw, username: "", password: "" };
  }
};

const normalizeCameraInput = async (env: Env, data: any) => {
  const result = { ...data };
  for (const key of ["rtsp_url", "main_stream", "sub_stream"]) {
    if (!result[key]) continue;
    const parsed = splitCredentials(result[key]);
    result[key] = parsed.url;
    if (parsed.username && !result.username) result.username = parsed.username;
    if (parsed.password && !result.password) result.password = parsed.password;
  }
  return result;
};

const migrateCameraCredentials = (env: Env) => {
  if (!credentialMigrationPromise) {
    credentialMigrationPromise = (async () => {
      const cameras = await all(env.DB, "SELECT * FROM cameras");
      for (const camera of cameras) {
        const fields: Record<string, any> = {};
        let username = camera.username;
        let password = "";
        for (const key of ["rtsp_url", "main_stream", "sub_stream"]) {
          if (!camera[key]) continue;
          const parsed = splitCredentials(camera[key]);
          if (parsed.url === String(camera[key])) continue;
          fields[key] = parsed.url;
          if (parsed.username && !username) username = parsed.username;
          if (parsed.password && !password) password = parsed.password;
        }
        if (!Object.keys(fields).length) continue;
        if (username) fields.username = username;
        if (password) fields.password_enc = await encryptSecret(password, env.ENCRYPTION_KEY || env.SECRET_KEY);
        fields.updated_at = stamp();
        await run(env.DB, `UPDATE cameras SET ${Object.keys(fields).map((key) => `${key}=?`).join(",")} WHERE id=?`, ...Object.values(fields), camera.id);
      }
    })().catch((error) => {
      credentialMigrationPromise = undefined;
      throw error;
    });
  }
  return credentialMigrationPromise;
};

let credentialMigrationPromise: Promise<void> | undefined;

const cameraSource = async (env: Env, camera: any): Promise<string> => {
  const value = normalizeRtspUrl(camera.rtsp_url || camera.main_stream || "");
  if (!/^rtsps?:\/\//i.test(value)) return value;
  const url = new URL(value);
  if (camera.username) {
    const secret = await decryptSecret(camera.password_enc, env.ENCRYPTION_KEY || env.SECRET_KEY);
    if (!url.username) url.username = String(camera.username);
    if (!url.password) url.password = secret || "";
  }
  return url.toString();
};

const cameraView = (camera: any) => ({
  id: camera.id,
  name: camera.name,
  location: camera.location,
  manufacturer: camera.manufacturer,
  model: camera.model,
  host: camera.host,
  port: camera.port,
  protocol: camera.protocol,
  rtsp_url: redactStreamUrl(camera.rtsp_url),
  onvif_url: redactStreamUrl(camera.onvif_url),
  username: camera.username ?? null,
  main_stream: redactStreamUrl(camera.main_stream),
  sub_stream: redactStreamUrl(camera.sub_stream),
  user_id: camera.user_id ?? null,
  enabled: !!camera.enabled,
  recording_enabled: !!camera.recording_enabled,
  ai_enabled: !!camera.ai_enabled,
  created_at: camera.created_at,
  updated_at: camera.updated_at,
  password: null
});

const zoneView = (zone: any) => ({
  id: zone.id,
  camera_id: zone.camera_id,
  name: zone.name,
  zone_type: zone.zone_type,
  points: parseJson(zone.points, []),
  enabled: !!zone.enabled,
  object_filters: parseJson(zone.object_filters, []),
  confidence_threshold: zone.confidence_threshold,
  direction: zone.direction ?? null,
  created_at: zone.created_at,
  updated_at: zone.updated_at
});

const shareView = (share: any) => ({
  id: share.id,
  camera_id: share.camera_id,
  username: share.username,
  role: share.role,
  permission: share.permission,
  created_at: share.created_at
});

const isAdmin = (user: any) => String(user?.role ?? "").toLowerCase() === "admin";
const isOperator = (user: any) => String(user?.role ?? "").toLowerCase() === "operator";
const hasPermission = (user: any, key: string, fallback = true) => {
  const permissions = parseJson(user?.permissions, {});
  return permissions[key] === undefined ? fallback : !!permissions[key];
};

const accessibleCameraIds = async (db: any, user: any): Promise<number[]> => {
  if (isAdmin(user)) return (await all(db, "SELECT id FROM cameras ORDER BY id")).map((row: any) => Number(row.id));
  if (!hasPermission(user, "cameras.view", true)) return [];
  const owned = await all(db, "SELECT id FROM cameras WHERE user_id=? ORDER BY id", user.id);
  const shared = await all(db, "SELECT camera_id FROM shares WHERE lower(username)=lower(?) ORDER BY camera_id", String(user?.username ?? ""));
  return [...new Set([...owned.map((row: any) => Number(row.id)), ...shared.map((row: any) => Number(row.camera_id))])].sort((left, right) => left - right);
};

const cameraFor = async (db: any, user: any, cameraId: number, mode: "view" | "manage" | "owner" = "view"): Promise<any> => {
  const id = Number(cameraId);
  if (!Number.isFinite(id)) return fail("Camera not found", 404);
  const camera = await first(db, "SELECT * FROM cameras WHERE id=?", id);
  if (!camera) return fail("Camera not found", 404);
  if (isAdmin(user)) return { camera, owner: true, readOnly: false };
  const owner = Number(camera.user_id) === Number(user.id);
  if (mode === "owner") return owner ? { camera, owner, readOnly: false } : fail("Only the camera owner can manage sharing", 403);
  const share = await first(db, "SELECT * FROM shares WHERE camera_id=? AND lower(username)=lower(?) LIMIT 1", id, String(user?.username ?? ""));
  if (!owner && !share) return fail("Camera not found", 404);
  if (mode === "manage") {
    const allowed = owner || (String(share?.permission ?? "") === "operator" && (isOperator(user) || hasPermission(user, "cameras.manage", false)));
    if (!allowed) return fail("Camera access is read-only", 403);
  }
  return { camera, owner, readOnly: false };
};

const cameraFilterSql = (ids: number[], params: any[], column = "camera_id", includeNull = false) => {
  if (!ids.length) return includeNull ? ` AND ${column} IS NULL` : " AND 1=0";
  params.push(...ids);
  const list = `${column} IN (${ids.map(() => "?").join(",")})`;
  return includeNull ? ` AND (${list} OR ${column} IS NULL)` : ` AND ${list}`;
};

const isValidPermission = (value: any) => ["viewer", "operator"].includes(String(value ?? ""));

const integrationView = (item: any) => ({
  id: item.id,
  name: item.name,
  kind: item.kind,
  endpoint: item.endpoint,
  auth_method: item.auth_method,
  enabled: !!item.enabled,
  created_at: item.created_at
});

const storageView = (item: any) => ({
  id: item.id,
  name: item.name,
  kind: item.kind,
  endpoint: item.endpoint,
  base_path: item.base_path ?? null,
  bucket: item.bucket ?? null,
  region: item.region ?? null,
  auth_method: item.auth_method,
  enabled: !!item.enabled,
  last_status: item.last_status,
  last_error: item.last_error ?? null,
  last_checked_at: item.last_checked_at ?? null,
  created_at: item.created_at,
  updated_at: item.updated_at
});

const eventView = (item: any) => ({
  id: item.id,
  camera_id: item.camera_id ?? null,
  camera_name: item.camera_name ?? null,
  kind: item.kind,
  object_name: item.object_name ?? null,
  confidence: item.confidence ?? null,
  occurred_at: item.occurred_at,
  snapshot_path: item.snapshot_path ?? null,
  snapshot_url: item.snapshot_url ?? null,
  clip_path: item.clip_path ?? null,
  clip_url: item.clip_url ?? null,
  description: item.description ?? null,
  track_id: item.track_id ?? null,
  recording_id: item.recording_id ?? null,
  bounding_box: parseJson(item.bounding_box, null),
  duration_seconds: item.duration_seconds ?? null
});

const personSessionView = (item: any) => ({
  id: Number(item.id),
  camera_id: item.camera_id ?? null,
  camera_name: item.camera_name ?? null,
  session_key: item.session_key ?? null,
  object_name: item.object_name ?? "person",
  entry_at: item.entry_at,
  last_seen_at: item.last_seen_at ?? null,
  exit_at: item.exit_at ?? null,
  duration_seconds: item.duration_seconds ?? null,
  status: item.status ?? "active",
  activity: item.activity ?? null,
  snapshot_path: item.snapshot_path ?? null,
  snapshot_url: item.snapshot_path ? `/api/ai/snapshot?camera_id=${item.camera_id}&path=${encodeURIComponent(item.snapshot_path)}` : null
});

const alertView = (item: any) => ({
  id: item.id,
  camera_id: item.camera_id ?? null,
  camera_name: item.camera_name ?? null,
  kind: item.kind,
  message: item.message,
  severity: item.severity ?? "warning",
  status: item.status,
  created_at: item.created_at,
  updated_at: item.updated_at ?? item.created_at
});

const zeroUsage = (source: string) => ({
  total_bytes: 0,
  used_bytes: 0,
  available_bytes: 0,
  percent_used: 0,
  source
});

let seedPromise: Promise<void> | undefined;

const ensureSeeded = (env: Env) => {
  if (!seedPromise) {
    seedPromise = (async () => {
      const existing = await first(env.DB, "SELECT id FROM users LIMIT 1");
      if (!existing) {
        const username = (env.ADMIN_USERNAME || "admin").trim();
        const password = env.ADMIN_PASSWORD;
        if (password) {
          await run(
            env.DB,
            "INSERT INTO users (username,password_hash,role,permissions,is_active,created_at) VALUES (?,?,?,?,?,?)",
            username,
            await hashPassword(password),
            "admin",
            "{}",
            1,
            stamp()
          );
        }
      }
      await migrateCameraCredentials(env);
    })().catch((error) => {
      seedPromise = undefined;
      throw error;
    });
  }
  return seedPromise;
};

const requestIp = (request: Request) =>
  request.headers.get("cf-connecting-ip") || String(request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "";

const requestUserAgent = (request: Request) => String(request.headers.get("user-agent") || "").slice(0, 500);

const toTime = (value: any) => {
  const time = Date.parse(String(value ?? ""));
  return Number.isFinite(time) ? time : 0;
};

const audit = async (request: Request, env: Env, user: any, action: string, target: string, cameraId?: number | null) => {
  try {
    await run(
      env.DB,
      "INSERT INTO audit_logs (user_id,username,action,target,camera_id,ip,created_at) VALUES (?,?,?,?,?,?,?)",
      user?.id ?? null,
      user?.username ?? null,
      action,
      target,
      Number.isFinite(Number(cameraId)) ? Number(cameraId) : null,
      requestIp(request),
      stamp()
    );
  } catch {
    return;
  }
};

const openSessionHistory = async (request: Request, env: Env, token: string, user: any, expiresAt: string, loginAt = stamp()) => {
  try {
    await run(
      env.DB,
      `INSERT OR IGNORE INTO user_sessions_history (id,user_id,username,login_at,last_seen_at,expires_at,ip,user_agent,created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      token,
      user?.id ?? null,
      user?.username ?? null,
      loginAt,
      loginAt,
      expiresAt,
      requestIp(request),
      requestUserAgent(request),
      stamp()
    );
  } catch {
    return;
  }
};

const closeSessionHistory = async (env: Env, token: string, reason: string) => {
  try {
    const now = stamp();
    await run(
      env.DB,
      "UPDATE user_sessions_history SET logout_at=?, end_reason=?, last_seen_at=COALESCE(last_seen_at,?) WHERE id=? AND logout_at IS NULL",
      now,
      reason,
      now,
      token
    );
  } catch {
    return;
  }
};

const touchSession = async (request: Request, env: Env, token: string, session: any, user: any) => {
  const lastSeen = toTime(session.last_seen_at ?? session.created_at);
  if (Date.now() - lastSeen < 60000) return;
  const now = stamp();
  await openSessionHistory(request, env, token, user, session.expires_at, session.created_at || now);
  try {
    await run(env.DB, "UPDATE sessions SET last_seen_at=? WHERE id=?", now, token);
    await run(env.DB, "UPDATE user_sessions_history SET last_seen_at=?, username=COALESCE(username,?) WHERE id=?", now, user?.username ?? null, token);
  } catch {
    return;
  }
};

const sweepExpiredSessions = async (env: Env) => {
  try {
    const expired = await all(env.DB, "SELECT id FROM sessions WHERE expires_at<=?", stamp());
    for (const session of expired) {
      await closeSessionHistory(env, String(session.id), "expired");
      await run(env.DB, "DELETE FROM sessions WHERE id=?", String(session.id));
    }
  } catch {
    return;
  }
};

const currentUser = async (request: Request, env: Env) => {
  const token = parseCookies(request).localvision_session;
  if (!token) return null;
  const session = await first(env.DB, "SELECT * FROM sessions WHERE id=?", token);
  if (!session) return null;
  if (new Date(session.expires_at).getTime() <= Date.now()) {
    await closeSessionHistory(env, token, "expired");
    await run(env.DB, "DELETE FROM sessions WHERE id=?", token);
    return null;
  }
  const user = await first(env.DB, "SELECT * FROM users WHERE id=?", session.user_id);
  if (!user || !user.is_active) return null;
  await touchSession(request, env, token, session, user);
  return user;
};

const login = async (request: Request, env: Env): Promise<Response> => {
  const data = await bodyOf(request);
  const username = String(data.username ?? "").trim();
  const password = String(data.password ?? "");
  const user = await first(env.DB, "SELECT * FROM users WHERE username=?", username);
  if (!user || !(await verifyPassword(password, user.password_hash))) return fail("Invalid username or password", 401);
  if (!user.is_active) return fail("Account is disabled", 403);
  const token = randomToken();
  const hours = sessionHours(env);
  const expiresAt = new Date(Date.now() + hours * 3600000).toISOString();
  const now = stamp();
  await run(
    env.DB,
    "INSERT INTO sessions (id,user_id,expires_at,last_seen_at,created_at) VALUES (?,?,?,?,?)",
    token,
    user.id,
    expiresAt,
    now,
    now
  );
  await openSessionHistory(request, env, token, user, expiresAt, now);
  await audit(request, env, user, "login", "session");
  const maxAge = data.remember_me ? hours * 3600 : undefined;
  return json(
    { user: userView(user), authenticated: true },
    200,
    { "set-cookie": sessionCookie(request, token, maxAge) }
  );
};

const guestLogin = async (request: Request, env: Env): Promise<Response> => {
  if (String(env.ALLOW_GUEST_MODE ?? "false").toLowerCase() !== "true") {
    return fail("Guest mode is disabled", 403);
  }
  let user = await first(env.DB, "SELECT * FROM users WHERE username=?", "guest");
  if (!user) {
    await run(
      env.DB,
      "INSERT INTO users (username,password_hash,role,permissions,is_active,created_at) VALUES (?,?,?,?,?,?)",
      "guest",
      await hashPassword(randomToken(24)),
      "viewer",
      "{}",
      1,
      stamp()
    );
    user = await first(env.DB, "SELECT * FROM users WHERE username=?", "guest");
  }
  const token = randomToken();
  const expiresAt = new Date(Date.now() + 3600000).toISOString();
  const now = stamp();
  await run(
    env.DB,
    "INSERT INTO sessions (id,user_id,expires_at,last_seen_at,created_at) VALUES (?,?,?,?,?)",
    token,
    user.id,
    expiresAt,
    now,
    now
  );
  await openSessionHistory(request, env, token, user, expiresAt, now);
  await audit(request, env, user, "guest_login", "session");
  return json({ user: userView(user), authenticated: true }, 200, {
    "set-cookie": sessionCookie(request, token, 3600)
  });
};

const cameraProtocols = ["RTSP", "ONVIF", "HTTP", "MJPEG", "Other"];

const importCamerasFromApi = async (request: Request, env: Env, user: any): Promise<Response> => {
  const data = await bodyOf(request);
  const endpointRaw = String(data.endpoint ?? "").trim();
  const apiKey = String(data.api_key ?? "");

  if (!endpointRaw) return fail("Camera API endpoint is required", 422);
  let endpoint: URL;
  try {
    endpoint = new URL(endpointRaw);
  } catch {
    return fail(`Invalid camera API URL: ${endpointRaw}`, 422);
  }
  if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") {
    return fail(`Camera API URL must use http or https: ${endpointRaw}`, 422);
  }
  if (!endpoint.hostname) return fail(`Invalid camera API URL: ${endpointRaw}`, 422);
  if (!apiKey) return fail("API key is required", 422);
  if (apiKey.length > 500) return fail("API key is too long", 422);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  let upstream: Response;
  try {
    upstream = await fetch(endpoint.toString(), {
      method: "GET",
      headers: { "X-API-Key": apiKey, Accept: "application/json" },
      signal: controller.signal,
      redirect: "follow"
    });
  } catch (error: any) {
    return fail(`Could not reach camera API: ${error?.message || "unknown error"}`, 502);
  } finally {
    clearTimeout(timeout);
  }

  const rawText = await upstream.text();
  const snippet = (value: string) => (value.length > 500 ? `${value.slice(0, 500)}…` : value);
  if (!upstream.ok) {
    if (upstream.status === 403 && /error code:\s*1003|direct ip access not allowed/i.test(rawText)) {
      return fail(`Camera API rejected a direct IP request (HTTP 403, error code 1003). Use the camera API's domain name instead of an IP address: ${endpointRaw}`, 502);
    }
    return fail(`Camera API returned HTTP ${upstream.status}: ${snippet(rawText)}`, 502);
  }

  let payload: any;
  try {
    payload = JSON.parse(rawText);
  } catch {
    return fail(`Camera API did not return valid JSON: ${snippet(rawText)}`, 502);
  }
  if (!Array.isArray(payload)) return fail("Camera API must return a JSON array", 422);
  if (payload.length > 100) return fail(`Camera API returned ${payload.length} cameras; maximum is 100`, 422);

  const candidates: any[] = [];
  for (let index = 0; index < payload.length; index += 1) {
    const item = payload[index];
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return fail(`Camera at index ${index} is invalid: expected an object`, 422);
    }
    const name = String(item.name ?? "").trim();
    const host = String(item.host ?? "").trim();
    if (!name) return fail(`Camera at index ${index} is invalid: name is required`, 422);
    if (!host) return fail(`Camera at index ${index} is invalid: host is required`, 422);
    const port = item.port === undefined || item.port === null || item.port === "" ? 554 : Number(item.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return fail(`Camera at index ${index} has an invalid port: ${String(item.port)}`, 422);
    }
    const protocol = String(item.protocol ?? "RTSP");
    if (!cameraProtocols.includes(protocol)) {
      return fail(`Camera at index ${index} has an invalid protocol: ${protocol}`, 422);
    }
    const externalValue = item.id === undefined || item.id === null ? "" : String(item.id).trim();
    const identity = `${host.toLowerCase()}:${port}:${protocol}`;
    candidates.push({
      item,
      name,
      host,
      port,
      protocol,
      identity,
      externalId: externalValue ? `id:${externalValue}` : `route:${identity}`
    });
  }

  const normalizedEndpoint = endpoint.toString();
  const importedRows = await all(env.DB, "SELECT external_id, host, port, protocol FROM cameras WHERE import_endpoint=?", normalizedEndpoint);
  const existingExternal = new Set(importedRows.map((row) => String(row.external_id)));
  const allCameras = await all(env.DB, "SELECT host, port, protocol FROM cameras");
  const existingIdentity = new Set(allCameras.map((row) => `${String(row.host).toLowerCase()}:${row.port}:${row.protocol}`));

  const statements: any[] = [];
  let imported = 0;
  let skipped = 0;
  for (const candidate of candidates) {
    if (existingExternal.has(candidate.externalId) || existingIdentity.has(candidate.identity)) {
      skipped += 1;
      continue;
    }
    const item = candidate.item;
    const password = item.password ? String(item.password) : null;
    const createdAt = stamp();
    statements.push(
      env.DB.prepare(
        "INSERT INTO cameras (name,location,manufacturer,model,host,port,protocol,rtsp_url,onvif_url,username,password_enc,main_stream,sub_stream,enabled,recording_enabled,ai_enabled,import_endpoint,external_id,user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
      ).bind(
        candidate.name,
        String(item.location ?? "").slice(0, 200),
        String(item.manufacturer ?? "Generic").slice(0, 80),
        String(item.model ?? "").slice(0, 120),
        candidate.host,
        candidate.port,
        candidate.protocol,
        item.rtsp_url ? String(item.rtsp_url) : null,
        item.onvif_url ? String(item.onvif_url) : null,
        item.username ? String(item.username) : null,
        await encryptSecret(password, env.ENCRYPTION_KEY || env.SECRET_KEY),
        item.main_stream ? String(item.main_stream) : null,
        item.sub_stream ? String(item.sub_stream) : null,
        item.enabled === false ? 0 : 1,
        item.recording_enabled === false ? 0 : 1,
        item.ai_enabled === false ? 0 : 1,
        normalizedEndpoint,
        candidate.externalId,
        user?.id ?? null,
        createdAt,
        createdAt
      )
    );
    existingExternal.add(candidate.externalId);
    existingIdentity.add(candidate.identity);
    imported += 1;
  }

  if (statements.length) {
    try {
      await env.DB.batch(statements);
    } catch (error: any) {
      return fail(`Database save failed: ${error?.message || "unknown error"}`, 500);
    }
    await audit(request, env, user, "camera.api_imported", String(imported));
  }
  return json({ imported, skipped });
};

const bridgeFetch = async (env: Env, path: string, init: RequestInit = {}): Promise<Response> => {
  if (!env.MEDIA_BRIDGE_URL || !env.MEDIA_BRIDGE_TOKEN) throw new Error("Media bridge is not configured.");
  const target = new URL(path, env.MEDIA_BRIDGE_URL);
  const headers = new Headers(init.headers);
  headers.set("X-Bridge-Token", env.MEDIA_BRIDGE_TOKEN);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    return await fetch(target.toString(), { ...init, headers, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

const proxyMedia = async (request: Request, env: Env, camera: any, snapshotOnly: boolean): Promise<Response> => {
  try {
    const path = snapshotOnly ? `/camera/${Number(camera.id)}/snapshot` : "/stream";
    const headers: Record<string, string> = { Accept: snapshotOnly ? "image/jpeg" : "multipart/x-mixed-replace" };
    if (!snapshotOnly) {
      const source = await cameraSource(env, camera);
      if (!source) return fail("No RTSP stream URL is configured for this camera.", 422);
      headers["X-RTSP-URL"] = source;
    }
    const upstream = await bridgeFetch(env, path, {
      headers,
      signal: request.signal
    });
    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => "");
      return fail(`Media bridge error: ${detail.slice(0, 500)}`, 502);
    }
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "content-type": upstream.headers.get("content-type") || (snapshotOnly ? "image/jpeg" : "multipart/x-mixed-replace; boundary=frame"),
        "cache-control": "no-store",
        "x-accel-buffering": "no"
      }
    });
  } catch (error: any) {
    return fail(`Media bridge is unreachable: ${error?.message || "unknown error"}`, 502);
  }
};

const proxyHls = async (env: Env, camera: any, segment?: string): Promise<Response> => {
  try {
    const path = segment
      ? `/hls/${Number(camera.id)}/${encodeURIComponent(segment)}`
      : `/hls/${Number(camera.id)}/index.m3u8`;
    const upstream = await bridgeFetch(env, path, { headers: { Accept: segment ? "video/mp2t" : "application/vnd.apple.mpegurl" } });
    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => "");
      return fail(`Media bridge error: ${detail.slice(0, 500)}`, 502);
    }
    if (segment) {
      return new Response(upstream.body, { status: upstream.status, headers: { "content-type": "video/mp2t", "cache-control": "no-store" } });
    }
    const base = `/api/cameras/${Number(camera.id)}/hls/`;
    const lines = (await upstream.text()).split(/\r?\n/).map((line) => {
      const value = line.trim();
      if (!value || value.startsWith("#") || /^[a-z]+:\/\//i.test(value)) return value;
      return `${base}${encodeURIComponent(value.replace(/^\/+/, ""))}`;
    }).filter(Boolean).filter(line => line !== "#EXTM3U");
    const playlist = ["#EXTM3U", ...lines].join("\n") + "\n";
    return new Response(playlist, { status: upstream.status, headers: { "content-type": "application/vnd.apple.mpegurl", "cache-control": "no-store" } });
  } catch (error: any) {
    return fail(`Media bridge is unreachable: ${error?.message || "unknown error"}`, 502);
  }
};

const cameraBridgeAction = async (env: Env, camera: any, path: string, method = "GET", payload?: any): Promise<Response> => {
  try {
    const source = await cameraSource(env, camera);
    const headers: Record<string, string> = { "X-RTSP-URL": source };
    const upstream = await bridgeFetch(env, `/camera/${Number(camera.id)}${path}`, {
      method,
      headers: payload ? { ...headers, "Content-Type": "application/json" } : headers,
      body: payload ? JSON.stringify(payload) : undefined
    });
    const text = await upstream.text();
    let data: any;
    try { data = text ? JSON.parse(text) : {}; } catch { data = { detail: text.slice(0, 500) }; }
    return json(data, upstream.status);
  } catch (error: any) {
    return fail(`Media bridge is unreachable: ${error?.message || "unknown error"}`, 502);
  }
};

const bridgeConfig = async (env: Env): Promise<Response> => {
  const cameras = await all(env.DB, "SELECT * FROM cameras WHERE enabled=1 ORDER BY id");
  const storageRows = await all(env.DB, "SELECT * FROM storage_servers WHERE enabled=1 AND endpoint<>'' ORDER BY id");
  const storage = storageRows.find((row: any) => row.secret_enc) ?? storageRows[0] ?? null;
  const zones = await all(env.DB, "SELECT * FROM zones WHERE enabled=1 ORDER BY camera_id,id");
  const settings = await all(env.DB, "SELECT * FROM ai_settings WHERE enabled=1 ORDER BY camera_id,id");
  return json({
    cameras: await Promise.all(cameras.map(async (camera: any) => ({
      id: Number(camera.id),
      name: camera.name,
      source: await cameraSource(env, camera),
      enabled: !!camera.enabled,
      recording_enabled: !!camera.recording_enabled,
      ai_enabled: !!camera.ai_enabled
    }))),
    zones: zones.map((zone: any) => ({
      id: Number(zone.id),
      camera_id: Number(zone.camera_id),
      name: zone.name,
      zone_type: zone.zone_type,
      points: parseJson(zone.points, []),
      object_filters: parseJson(zone.object_filters, []),
      confidence_threshold: Number(zone.confidence_threshold ?? 0.5),
      direction: zone.direction ?? null
    })),
    ai_settings: settings.map((setting: any) => ({
      camera_id: setting.camera_id ? Number(setting.camera_id) : null,
      key: setting.key,
      value: setting.value,
      enabled: !!setting.enabled
    })),
    storage: storage ? {
      id: Number(storage.id),
      endpoint: storageBaseUrl(storage.endpoint),
      auth_method: storage.auth_method || "none",
      secret: await decryptSecret(storage.secret_enc, env.ENCRYPTION_KEY || env.SECRET_KEY)
    } : null,
    generated_at: stamp()
  });
};

const bridgeRecordingUpsert = async (request: Request, env: Env): Promise<Response> => {
  const data = await bodyOf(request);
  const cameraId = Number(data.camera_id);
  if (!Number.isFinite(cameraId)) return fail("camera_id is required", 422);
  const camera = await first(env.DB, "SELECT id,name FROM cameras WHERE id=?", cameraId);
  if (!camera) return fail("Camera not found", 404);
  const storageId = data.storage_server_id ? Number(data.storage_server_id) : null;
  const storageIdValue = Number.isFinite(storageId) ? storageId : null;
  const recordingId = String(data.storage_recording_id ?? "").trim() || null;
  const startedAt = String(data.started_at ?? stamp());
  const endedAt = data.ended_at ? String(data.ended_at) : null;
  const values = [
    cameraId,
    storageIdValue,
    recordingId,
    String(data.name ?? camera.name),
    String(data.camera ?? camera.name),
    String(data.date ?? startedAt.slice(0, 10)),
    String(data.time ?? (startedAt.slice(11, 19) || "00:00:00")),
    String(data.filename ?? "recording.mp4"),
    data.duration_seconds === null || data.duration_seconds === undefined ? null : Number(data.duration_seconds),
    Number(data.size_bytes ?? 0) || 0,
    String(data.status ?? "ready"),
    startedAt,
    endedAt
  ];
  const existing = recordingId
    ? await first(env.DB, "SELECT * FROM camera_recordings WHERE storage_recording_id=?", recordingId)
    : await first(env.DB, "SELECT * FROM camera_recordings WHERE camera_id=? AND filename=? ORDER BY id DESC LIMIT 1", cameraId, String(data.filename ?? "recording.mp4"));
  if (existing) {
    await run(
      env.DB,
      `UPDATE camera_recordings SET camera_id=?,storage_server_id=?,storage_recording_id=?,name=?,camera=?,date=?,time=?,filename=?,
       duration_seconds=?,size_bytes=?,status=?,started_at=?,ended_at=?,updated_at=? WHERE id=?`,
      ...values,
      stamp(),
      existing.id
    );
    return json({ id: Number(existing.id) }, 200);
  }
  await run(
    env.DB,
    `INSERT INTO camera_recordings (camera_id,storage_server_id,storage_recording_id,name,camera,date,time,filename,duration_seconds,size_bytes,status,started_at,ended_at,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ...values,
    stamp(),
    stamp()
  );
  const saved = recordingId
    ? await first(env.DB, "SELECT * FROM camera_recordings WHERE storage_recording_id=?", recordingId)
    : await first(env.DB, "SELECT * FROM camera_recordings WHERE camera_id=? AND filename=? ORDER BY id DESC LIMIT 1", cameraId, String(data.filename ?? "recording.mp4"));
  return json({ id: Number(saved?.id ?? 0) }, 201);
};

const recordingView = (row: any) => ({
  id: Number(row.id),
  camera_id: Number(row.camera_id),
  camera: row.camera ?? row.name ?? `Camera ${row.camera_id}`,
  name: row.name ?? row.filename,
  date: row.date ?? null,
  time: row.time ?? null,
  path: row.filename ?? "",
  filename: row.filename ?? "recording.mp4",
  started_at: row.started_at,
  ended_at: row.ended_at ?? null,
  duration_seconds: row.duration_seconds ?? null,
  size_bytes: Number(row.size_bytes ?? 0) || 0,
  kind: "continuous",
  status: row.status ?? "ready",
  review_status: row.review_status ?? "unreviewed",
  reviewed_by: row.reviewed_by ?? null,
  reviewed_at: row.reviewed_at ?? null,
  storage_server_id: row.storage_server_id ?? null,
  storage_recording_id: row.storage_recording_id ?? null,
  fileUrl: row.storage_server_id && row.storage_recording_id ? `/api/recordings/${row.id}/file` : null,
  downloadUrl: row.storage_server_id && row.storage_recording_id ? `/api/recordings/${row.id}/download` : null
});

const storedRecordingId = (row: any) => String(row.storage_recording_id ?? `${row.camera ?? row.camera_id ?? "Camera"}|${row.date ?? ""}|${row.filename ?? "recording.mp4"}`);

const deleteStoredRecording = async (request: Request, env: Env, row: any) => {
  const server = row.storage_server_id
    ? await first(env.DB, "SELECT * FROM storage_servers WHERE id=?", Number(row.storage_server_id))
    : await first(env.DB, "SELECT * FROM storage_servers WHERE enabled=1 ORDER BY id LIMIT 1");
  if (!server) throw new Error("No configured storage server is available to delete this file");
  const id = storedRecordingId(row);
  const response = await storageFetch(env, server, `api/recordings/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!response.ok && response.status !== 404) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Storage API returned HTTP ${response.status}: ${detail.slice(0, 300)}`);
  }
  return { deleted: response.ok, storage_server_id: Number(server.id) };
};

const recordingRowFor = async (env: Env, id: number) => {
  const existing = await first(env.DB, "SELECT * FROM camera_recordings WHERE id=?", id);
  if (existing) return existing;
  if (id >= 0) return null;
  const views = await storageRecordingViews(env.DB, env);
  const view = views.find(item => Number(item.id) === id);
  if (!view) return null;
  const cameraId = Number(view.camera_id) > 0 ? Number(view.camera_id) : null;
  if (!cameraId) return null;
  const storageId = String(view.storage_recording_id ?? "");
  const byStorage = storageId
    ? await first(env.DB, "SELECT * FROM camera_recordings WHERE storage_server_id=? AND storage_recording_id=?", view.storage_server_id, storageId)
    : null;
  if (byStorage) return byStorage;
  const startedAt = String(view.started_at ?? stamp());
  await run(
    env.DB,
    `INSERT INTO camera_recordings (camera_id,storage_server_id,storage_recording_id,name,camera,date,time,filename,duration_seconds,size_bytes,status,started_at,ended_at,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    cameraId,
    view.storage_server_id ?? null,
    storageId || null,
    view.name ?? view.filename ?? "recording.mp4",
    view.camera ?? `Camera ${cameraId}`,
    view.date ?? startedAt.slice(0, 10),
    view.time ?? startedAt.slice(11, 19),
    view.filename ?? "recording.mp4",
    view.duration_seconds ?? null,
    Number(view.size_bytes ?? 0) || 0,
    view.status ?? "ready",
    startedAt,
    view.ended_at ?? null,
    stamp(),
    stamp()
  );
  const saved = storageId
    ? await first(env.DB, "SELECT * FROM camera_recordings WHERE storage_server_id=? AND storage_recording_id=?", view.storage_server_id, storageId)
    : await first(env.DB, "SELECT * FROM camera_recordings WHERE camera_id=? AND filename=? ORDER BY id DESC LIMIT 1", cameraId, view.filename ?? "recording.mp4");
  return saved;
};

const recordingsRoute = async (request: Request, env: Env, parts: string[], method: string, url: URL, user: any): Promise<Response> => {
  const db = env.DB;
  if (parts.length === 2 && method === "GET") {
    const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
    const pageSize = Math.max(1, Number(url.searchParams.get("page_size") ?? 50));
    const params: any[] = [];
    const cameraId = Number(url.searchParams.get("camera_id"));
    const cameraFilter = Number.isFinite(cameraId) && cameraId > 0 ? cameraId : null;
    const date = String(url.searchParams.get("date") ?? "").trim();
    const visibleIds = await accessibleCameraIds(db, user);
    if (cameraFilter && !visibleIds.includes(cameraFilter)) return json({ items: [], page, page_size: pageSize });
    const allowedIds = new Set(visibleIds);
    let sql = "SELECT * FROM camera_recordings WHERE 1=1";
    if (cameraFilter) { sql += " AND camera_id=?"; params.push(cameraFilter); }
    if (visibleIds.length) { sql += ` AND camera_id IN (${visibleIds.map(() => "?").join(",")})`; params.push(...visibleIds); }
    else sql += " AND 1=0";
    if (date) { sql += " AND date=?"; params.push(date); }
    sql += " ORDER BY started_at DESC";
    const rows = await all(db, sql, ...params);
    const storageViews = await storageRecordingViews(db, env);
    const keyFor = (item: any) => `${cameraKey(item.camera || item.camera_id)}|${item.date ?? ""}|${item.filename ?? ""}`;
    const merged = new Map<string, any>();
    for (const item of storageViews) merged.set(keyFor(item), item);
    for (const row of rows) {
      const view = recordingView(row);
      const key = keyFor(view);
      const existing = merged.get(key);
      merged.set(key, existing ? { ...existing, ...view, fileUrl: view.fileUrl || existing.fileUrl, downloadUrl: view.downloadUrl || existing.downloadUrl } : view);
    }
    const items = [...merged.values()]
      .filter(item => allowedIds.has(Number(item.camera_id)) && (!cameraFilter || item.camera_id === cameraFilter) && (!date || item.date === date))
      .sort((left, right) => String(right.started_at ?? right.date ?? "").localeCompare(String(left.started_at ?? left.date ?? "")))
      .slice((page - 1) * pageSize, page * pageSize);
    return json({ items, page, page_size: pageSize });
  }
  const id = Number(parts[2]);
  if (!Number.isFinite(id)) return fail("Recording not found", 404);
  const row = await recordingRowFor(env, id);
  if (!row) return fail("Recording not found", 404);
  const accessMode = method === "DELETE" ? "owner" : parts[3] === "review" ? "manage" : "view";
  const recordingAccess = await cameraFor(db, user, Number(row.camera_id), accessMode);
  if (recordingAccess instanceof Response) return recordingAccess;
  if (parts.length === 3 && method === "DELETE") {
    try {
      const removed = await deleteStoredRecording(request, env, row);
      if (Number(row.id) > 0) {
        await run(db, "DELETE FROM camera_recordings WHERE id=?", row.id);
        await run(db, "DELETE FROM recording_review_history WHERE recording_id=?", row.id);
      }
      await audit(request, env, user, "recording.deleted", `${row.id}|${storedRecordingId(row)}|${row.filename ?? ""}`, Number(row.camera_id));
      return json({ deleted: true, storage_deleted: removed.deleted, storage_server_id: removed.storage_server_id });
    } catch (error: any) {
      return fail(error?.message || "Could not delete the stored recording", 502);
    }
  }
  if (parts.length === 4 && parts[3] === "review" && ["POST", "PATCH", "PUT"].includes(method)) {
    const data = await bodyOf(request);
    const status = String(data.status ?? "reviewed").trim().toLowerCase();
    if (!["unreviewed", "reviewed", "flagged"].includes(status)) return fail("Review status must be unreviewed, reviewed, or flagged", 422);
    const previous = String(row.review_status ?? "unreviewed");
    const notes = String(data.notes ?? "").slice(0, 2000);
    const reviewedAt = stamp();
    await run(db, "UPDATE camera_recordings SET review_status=?,reviewed_by=?,reviewed_at=?,updated_at=? WHERE id=?", status, user.username ?? null, reviewedAt, reviewedAt, row.id);
    await run(
      db,
      "INSERT INTO recording_review_history (recording_id,camera_id,storage_recording_id,previous_status,review_status,reviewed_by,notes,created_at) VALUES (?,?,?,?,?,?,?,?)",
      row.id,
      row.camera_id,
      row.storage_recording_id ?? null,
      previous,
      status,
      user.username ?? null,
      notes || null,
      reviewedAt
    );
    try {
      const server = row.storage_server_id ? await first(db, "SELECT * FROM storage_servers WHERE id=?", row.storage_server_id) : null;
      if (server && row.storage_recording_id) {
        await storageFetch(env, server, `api/recordings/${encodeURIComponent(String(row.storage_recording_id))}/review`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status, reviewed_by: user.username ?? null, reviewed_at: reviewedAt, notes })
        });
      }
    } catch {}
    await audit(request, env, user, `recording.review.${status}`, `${row.id}|${storedRecordingId(row)}`, Number(row.camera_id));
    return json(recordingView(await first(db, "SELECT * FROM camera_recordings WHERE id=?", row.id)));
  }
  if (parts.length === 4 && parts[3] === "history" && method === "GET") {
    const reviews = await all(db, "SELECT * FROM recording_review_history WHERE recording_id=? OR storage_recording_id=? ORDER BY created_at DESC LIMIT 200", row.id, row.storage_recording_id ?? "");
    const auditRows = await all(db, "SELECT id,action,target,created_at,username FROM audit_logs WHERE action LIKE 'recording.%' AND (target=? OR target LIKE ?) ORDER BY created_at DESC LIMIT 200", String(row.id), `%${String(row.filename ?? "")}%`);
    return json({
      reviews: reviews.map(item => ({ ...item, id: Number(item.id) })),
      audit: auditRows.map(item => ({ ...item, id: Number(item.id) }))
    });
  }
  if (["file", "download"].includes(parts[3]) && method === "GET") {
    if (!row.storage_server_id || !row.storage_recording_id) return fail("Recording file is not available on configured storage", 404);
    const server = await first(db, "SELECT * FROM storage_servers WHERE id=?", row.storage_server_id);
    if (!server) return fail("Configured storage server no longer exists", 404);
    const subParts = ["", "storage", "servers", String(row.storage_server_id), "recordings", String(row.storage_recording_id), parts[3]];
    return storageServersRoute(request, env, subParts, "GET", user);
  }
  return fail("Not found", 404);
};

const camerasRoute = async (request: Request, env: Env, parts: string[], method: string, user: any): Promise<Response> => {
  const db = env.DB;
  const id = parts[2] ? Number(parts[2]) : NaN;
  const sub = parts[3];

  if (parts.length === 2) {
    if (method === "GET") {
      const ids = await accessibleCameraIds(db, user);
      if (!ids.length) return json([]);
      return json((await all(db, `SELECT * FROM cameras WHERE id IN (${ids.map(() => "?").join(",")}) ORDER BY id`, ...ids)).map(cameraView));
    }
    if (method === "POST") {
      if (!isAdmin(user) && !isOperator(user)) return fail("Administrator or operator access required", 403);
      const data = await normalizeCameraInput(env, await bodyOf(request));
      const host = String(data.host ?? "").trim();
      if (!host) return fail("RTSP IP / host is required");
      const name = String(data.name ?? "").trim() || `Camera ${host}`;
      const secret = env.ENCRYPTION_KEY || env.SECRET_KEY;
      await run(
        db,
        "INSERT INTO cameras (name,location,manufacturer,model,host,port,protocol,rtsp_url,onvif_url,username,password_enc,main_stream,sub_stream,enabled,recording_enabled,ai_enabled,user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        name,
        String(data.location ?? ""),
        String(data.manufacturer ?? "Generic"),
        String(data.model ?? ""),
        host,
        Number(data.port ?? 554),
        String(data.protocol ?? "RTSP"),
        data.rtsp_url || null,
        data.onvif_url || null,
        data.username || null,
        await encryptSecret(data.password || null, secret),
        data.main_stream || data.rtsp_url || null,
        data.sub_stream || null,
        data.enabled === false ? 0 : 1,
        data.recording_enabled === false ? 0 : 1,
        data.ai_enabled === false ? 0 : 1,
        user?.id ?? null,
        stamp(),
        stamp()
      );
      const created = await first(db, "SELECT * FROM cameras ORDER BY id DESC LIMIT 1");
      await audit(request, env, user, "camera.created", String(created?.id ?? ""), created?.id ?? null);
      return json(cameraView(created), 201);
    }
  }

  if (parts[2] === "discover" && method === "POST") {
    if (!isAdmin(user) && !isOperator(user)) return fail("Administrator or operator access required", 403);
    return json([]);
  }
  if (parts[2] === "import" && method === "POST") {
    if (!isAdmin(user) && !isOperator(user)) return fail("Administrator or operator access required", 403);
    return importCamerasFromApi(request, env, user);
  }
  if (parts[2] === "test" && method === "POST") {
    if (!isAdmin(user) && !isOperator(user)) return fail("Administrator or operator access required", 403);
    return json({ status: "unreachable", message: "Live camera probing is not available in the Cloudflare-only deployment." });
  }
  if (parts[2] === "onvif" && parts[3] === "inspect" && method === "POST") {
    if (!isAdmin(user) && !isOperator(user)) return fail("Administrator or operator access required", 403);
    return fail("ONVIF inspection requires a local network service and is unavailable in the Cloudflare-only deployment.", 501);
  }
  if (!Number.isFinite(id)) return fail("Camera not found", 404);
  const accessMode: "view" | "manage" | "owner" = sub === "shares" || (parts.length === 3 && method === "DELETE")
    ? "owner"
    : method === "GET" || sub === "snapshot" || sub === "preview.jpg" || sub === "stream.mjpeg" || sub === "live" || sub === "stream.m3u8" || sub === "hls"
      ? "view"
      : "manage";
  const access = await cameraFor(db, user, id, accessMode);
  if (access instanceof Response) return access;
  const camera = access.camera;

  if (parts.length === 3) {
    if (method === "GET") return json(cameraView(camera));
    if (method === "PUT") {
      const data = await normalizeCameraInput(env, await bodyOf(request));
      const fields: Record<string, any> = {};
      for (const key of ["name", "location", "manufacturer", "model", "host", "port", "protocol", "rtsp_url", "onvif_url", "username", "main_stream", "sub_stream"]) {
        if (key in data) fields[key] = data[key];
      }
      for (const key of ["enabled", "recording_enabled", "ai_enabled"]) {
        if (key in data) fields[key] = data[key] ? 1 : 0;
      }
      if (data.password) fields.password_enc = await encryptSecret(String(data.password), env.ENCRYPTION_KEY || env.SECRET_KEY);
      const keys = Object.keys(fields);
      if (keys.length) {
        await run(
          db,
          `UPDATE cameras SET ${keys.map((key) => `${key}=?`).join(",")}, updated_at=? WHERE id=?`,
          ...keys.map((key) => fields[key]),
          stamp(),
          id
        );
      }
      return json(cameraView(await first(db, "SELECT * FROM cameras WHERE id=?", id)));
    }
    if (method === "DELETE") {
      await run(db, "DELETE FROM cameras WHERE id=?", id);
      return empty();
    }
  }

  if (sub === "test" || sub === "test-draft") {
    const result = await cameraBridgeAction(env, camera, "/status");
    const body: any = await result.json().catch(() => ({}));
    const status = body.status === "online" || body.status === "recording" ? "reachable" : "unreachable";
    return json({ camera_id: id, status, message: body.message || (status === "reachable" ? "Camera connected and streaming." : "Camera is not reachable."), resolution: body.resolution || null, fps: body.fps ?? null });
  }
  if (sub === "status") {
    const result = await cameraBridgeAction(env, camera, "/status");
    const body: any = await result.json().catch(() => ({}));
    return json({ camera_id: id, ...body, protocol: camera.protocol });
  }
  if (sub === "recording" && parts[4] === "start" && method === "POST") {
    await run(db, "UPDATE cameras SET recording_enabled=1, updated_at=? WHERE id=?", stamp(), id);
    await audit(request, env, user, "camera.recording_started", String(id));
    return cameraBridgeAction(env, camera, "/record/start", "POST", { name: camera.name });
  }
  if (sub === "recording" && parts[4] === "stop" && method === "POST") {
    await run(db, "UPDATE cameras SET recording_enabled=0, updated_at=? WHERE id=?", stamp(), id);
    await audit(request, env, user, "camera.recording_stopped", String(id));
    return cameraBridgeAction(env, camera, "/record/stop", "POST");
  }
  if (sub === "recording" && parts[4] === "status") {
    return cameraBridgeAction(env, camera, "/record/status");
  }
  if (sub === "stream.m3u8") return proxyHls(env, camera);
  if (sub === "hls" && parts[4]) return proxyHls(env, camera, parts[4]);
  if (sub === "snapshot" || sub === "preview.jpg") return proxyMedia(request, env, camera, true);
  if (sub === "stream.mjpeg" || sub === "live") return proxyMedia(request, env, camera, false);

  if (sub === "zones") {
    if (method === "GET") {
      return json((await all(db, "SELECT * FROM zones WHERE camera_id=? ORDER BY id", id)).map(zoneView));
    }
    if (method === "POST") {
      const data = await bodyOf(request);
      await run(
        db,
        "INSERT INTO zones (camera_id,name,zone_type,points,enabled,object_filters,confidence_threshold,direction,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
        id,
        String(data.name ?? "Zone"),
        String(data.zone_type ?? "detection"),
        JSON.stringify(data.points ?? []),
        data.enabled === false ? 0 : 1,
        JSON.stringify(data.object_filters ?? []),
        Number(data.confidence_threshold ?? 0.5),
        data.direction || null,
        stamp(),
        stamp()
      );
      const created = await first(db, "SELECT * FROM zones ORDER BY id DESC LIMIT 1");
      return json(zoneView(created), 201);
    }
    const zoneId = Number(parts[4]);
    if (parts.length === 5 && method === "PUT") {
      const data = await bodyOf(request);
      const fields: Record<string, any> = {};
      if ("name" in data) fields.name = data.name;
      if ("zone_type" in data) fields.zone_type = data.zone_type;
      if ("points" in data) fields.points = JSON.stringify(data.points);
      if ("enabled" in data) fields.enabled = data.enabled ? 1 : 0;
      if ("object_filters" in data) fields.object_filters = JSON.stringify(data.object_filters);
      if ("confidence_threshold" in data) fields.confidence_threshold = Number(data.confidence_threshold);
      if ("direction" in data) fields.direction = data.direction || null;
      const keys = Object.keys(fields);
      if (keys.length) {
        await run(db, `UPDATE zones SET ${keys.map((key) => `${key}=?`).join(",")}, updated_at=? WHERE id=? AND camera_id=?`, ...keys.map((key) => fields[key]), stamp(), zoneId, id);
      }
      return json(zoneView(await first(db, "SELECT * FROM zones WHERE id=?", zoneId)));
    }
    if (parts.length === 5 && method === "DELETE") {
      await run(db, "DELETE FROM zones WHERE id=? AND camera_id=?", zoneId, id);
      return empty();
    }
  }

  if (sub === "shares") {
    if (method === "GET") {
      return json((await all(db, "SELECT * FROM shares WHERE camera_id=? ORDER BY id", id)).map(shareView));
    }
    if (method === "POST") {
      const data = await bodyOf(request);
      const username = String(data.username ?? "").trim();
      const permission = String(data.permission ?? "viewer");
      if (!username) return fail("Username is required", 422);
      if (!isValidPermission(permission)) return fail("Permission must be viewer or operator", 422);
      const target = await first(db, "SELECT * FROM users WHERE username=?", username);
      if (!target) return fail("No active user was found with that username", 404);
      if (!target.is_active) return fail("That user account is disabled", 403);
      if (Number(target.id) === Number(user.id)) return fail("You already own this camera", 422);
      const duplicate = await first(db, "SELECT id FROM shares WHERE camera_id=? AND lower(username)=lower(?)", id, username);
      if (duplicate) return fail("This user already has access to the camera", 409);
      await run(
        db,
        "INSERT INTO shares (camera_id,username,role,permission,created_at) VALUES (?,?,?,?,?)",
        id,
        target.username,
        target.role,
        permission,
        stamp()
      );
      const created = await first(db, "SELECT * FROM shares ORDER BY id DESC LIMIT 1");
      await audit(request, env, user, "sharing.created", String(id), id);
      return json(shareView(created), 201);
    }
    const shareId = Number(parts[4]);
    const share = Number.isFinite(shareId) ? await first(db, "SELECT * FROM shares WHERE id=? AND camera_id=?", shareId, id) : null;
    if (!share) return fail("Share not found", 404);
    if (parts.length === 5 && method === "PATCH") {
      const data = await bodyOf(request);
      const permission = String(data.permission ?? share.permission);
      if (!isValidPermission(permission)) return fail("Permission must be viewer or operator", 422);
      await run(db, "UPDATE shares SET permission=? WHERE id=?", permission, shareId);
      await audit(request, env, user, "sharing.updated", String(id), id);
      return json(shareView(await first(db, "SELECT * FROM shares WHERE id=?", shareId)));
    }
    if (parts.length === 5 && method === "DELETE") {
      await run(db, "DELETE FROM shares WHERE id=? AND camera_id=?", shareId, id);
      await audit(request, env, user, "sharing.revoked", String(id), id);
      return empty();
    }
  }

  return fail("Not found", 404);
};

const usersRoute = async (request: Request, env: Env, parts: string[], method: string, actor: any): Promise<Response> => {
  const db = env.DB;
  if (actor.role !== "admin") return fail("Administrator access required", 403);

  if (parts.length === 2) {
    if (method === "GET") {
      return json((await all(db, "SELECT * FROM users ORDER BY id")).map(userView));
    }
    if (method === "POST") {
      const data = await bodyOf(request);
      const username = String(data.username ?? "").trim();
      const password = String(data.password ?? "");
      if (username.length < 3 || password.length < 8) return fail("Username must be at least 3 characters and password at least 8 characters");
      const existing = await first(db, "SELECT id FROM users WHERE username=?", username);
      if (existing) return fail("Username already exists", 409);
      await run(
        db,
        "INSERT INTO users (username,password_hash,role,permissions,is_active,created_at) VALUES (?,?,?,?,?,?)",
        username,
        await hashPassword(password),
        String(data.role ?? "viewer"),
        JSON.stringify(data.permissions ?? {}),
        data.is_active === false ? 0 : 1,
        stamp()
      );
      const created = await first(db, "SELECT * FROM users WHERE username=?", username);
      await audit(request, env, actor, "user.created", username);
      return json(userView(created), 201);
    }
  }

  const id = Number(parts[2]);
  const user = await first(db, "SELECT * FROM users WHERE id=?", id);
  if (!user) return fail("User not found", 404);

  if (parts[3] === "sessions" && parts[4] === "revoke" && method === "POST") {
    const activeSessions = await all(db, "SELECT id FROM sessions WHERE user_id=?", id);
    for (const active of activeSessions) await closeSessionHistory(env, String(active.id), "revoked");
    await run(db, "DELETE FROM sessions WHERE user_id=?", id);
    await audit(request, env, actor, "sessions.revoked", String(id));
    return empty();
  }
  if (parts.length === 3 && method === "PATCH") {
    const data = await bodyOf(request);
    const fields: Record<string, any> = {};
    if ("username" in data) fields.username = String(data.username).trim();
    if ("role" in data) fields.role = String(data.role);
    if ("permissions" in data) fields.permissions = JSON.stringify(data.permissions ?? {});
    if ("is_active" in data) fields.is_active = data.is_active ? 1 : 0;
    if (data.password) {
      if (String(data.password).length < 8) return fail("Password must be at least 8 characters");
      fields.password_hash = await hashPassword(String(data.password));
    }
    const keys = Object.keys(fields);
    if (keys.length) await run(db, `UPDATE users SET ${keys.map((key) => `${key}=?`).join(",")} WHERE id=?`, ...keys.map((key) => fields[key]), id);
    return json(userView(await first(db, "SELECT * FROM users WHERE id=?", id)));
  }
  if (parts.length === 3 && method === "DELETE") {
    const activeSessions = await all(db, "SELECT id FROM sessions WHERE user_id=?", id);
    for (const active of activeSessions) await closeSessionHistory(env, String(active.id), "user_deleted");
    await run(db, "DELETE FROM sessions WHERE user_id=?", id);
    await run(db, "DELETE FROM users WHERE id=?", id);
    await audit(request, env, actor, "user.deleted", String(id));
    return empty();
  }
  return fail("Not found", 404);
};

const storageBaseUrl = (endpoint: string): string => {
  const url = new URL(endpoint);
  let pathname = url.pathname.replace(/\/+$/, "");
  const known = ["/api/storage/overview", "/api/storage", "/api"];
  for (const suffix of known) {
    if (pathname.endsWith(suffix)) {
      pathname = pathname.slice(0, -suffix.length);
      break;
    }
  }
  url.pathname = pathname;
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
};

const storageNumber = (value: any): number | null => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
};

const parseStorageUsage = (payload: any) => {
  let value = payload;
  for (let index = 0; index < 4 && value && typeof value === "object"; index += 1) {
    const nested = value.data ?? value.result ?? value.storage ?? value.usage;
    if (!nested || typeof nested !== "object" || nested === value) break;
    value = nested;
  }
  const pick = (keys: string[]) => {
    for (const key of keys) {
      const number = storageNumber(value?.[key]);
      if (number !== null) return number;
    }
    return null;
  };
  let total = pick(["total_bytes", "capacity_bytes", "total", "capacity"]);
  let used = pick(["used_bytes", "used", "used_space"]);
  let available = pick(["free_bytes", "available_bytes", "free", "available"]);
  if (total !== null && used !== null && available === null) available = Math.max(0, total - used);
  if (total !== null && available !== null && used === null) used = Math.max(0, total - available);
  if (used !== null && available !== null && total === null) total = used + available;
  const usage = {
    total_bytes: total ?? 0,
    used_bytes: used ?? 0,
    available_bytes: available ?? 0,
    percent_used: total && used ? Math.round((used / total) * 1000) / 10 : 0,
    source: "ubuntu-storage"
  };
  const raw = value?.cameras ?? value?.camera_usage ?? value?.per_camera ?? {};
  const cameras: any[] = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const cameraId = Number(item?.camera_id ?? item?.id);
      const usedBytes = storageNumber(item?.used_bytes ?? item?.used ?? item?.bytes) ?? 0;
      if (!Number.isFinite(cameraId)) continue;
      cameras.push({ camera_id: cameraId, used_bytes: usedBytes, status: String(item?.status ?? "online") });
    }
  } else if (raw && typeof raw === "object") {
    for (const [key, item] of Object.entries(raw)) {
      const cameraId = Number(key);
      const usedBytes = typeof item === "number" ? item : storageNumber((item as any)?.used_bytes ?? (item as any)?.used ?? (item as any)?.bytes) ?? 0;
      if (!Number.isFinite(cameraId)) continue;
      cameras.push({ camera_id: cameraId, used_bytes: usedBytes, status: String((item as any)?.status ?? "online") });
    }
  }
  return { usage, cameras };
};

const storageFetch = async (env: Env, item: any, subPath: string, init: RequestInit = {}): Promise<Response> => {
  const endpoint = String(item.endpoint ?? "").trim();
  if (!/^https?:\/\/\S+$/i.test(endpoint)) throw new Error("Storage API URL is missing or invalid");
  const target = new URL(subPath.replace(/^\/+/, ""), `${storageBaseUrl(endpoint)}/`);
  const secret = await decryptSecret(item.secret_enc, env.ENCRYPTION_KEY || env.SECRET_KEY);
  const headers = new Headers(init.headers || {});
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  if (item.auth_method === "none") {
    if (secret) headers.set("X-API-Key", secret);
  } else if (!secret) {
    throw new Error("Storage API key is missing or could not be decrypted; re-enter it");
  } else if (item.auth_method === "bearer") {
    headers.set("Authorization", `Bearer ${secret}`);
  } else if (item.auth_method === "basic") {
    headers.set("Authorization", `Basic ${secret}`);
  } else {
    headers.set("Authorization", `Bearer ${secret}`);
    headers.set("X-API-Key", secret);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    return await fetch(target.toString(), { ...init, headers, signal: controller.signal, redirect: "follow" });
  } catch (error: any) {
    throw new Error(`Could not reach storage API: ${error?.message || "unknown error"}`);
  } finally {
    clearTimeout(timer);
  }
};

const probeStorage = async (env: Env, item: any, persist = false) => {
  const checkedAt = stamp();
  try {
    const response = await storageFetch(env, item, "api/storage/overview");
    const text = await response.text();
    const snippet = (value: string) => (value.length > 500 ? `${value.slice(0, 500)}…` : value);
    if (!response.ok) {
      const message = response.status === 403 && /error code:\s*1003|direct ip access not allowed/i.test(text)
        ? "Storage API rejected a direct IP request (error code 1003). Use a domain name instead of an IP address."
        : `Storage API returned HTTP ${response.status}: ${snippet(text)}`;
      if (persist) await run(env.DB, "UPDATE storage_servers SET last_status=?,last_error=?,last_checked_at=? WHERE id=?", "error", message, checkedAt, item.id);
      return { status: "error", message, usage: null, cameras: [], checked_at: checkedAt };
    }
    let payload: any;
    try {
      payload = JSON.parse(text);
    } catch {
      const message = "Storage API did not return valid JSON";
      if (persist) await run(env.DB, "UPDATE storage_servers SET last_status=?,last_error=?,last_checked_at=? WHERE id=?", "error", message, checkedAt, item.id);
      return { status: "error", message, usage: null, cameras: [], checked_at: checkedAt };
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      const message = "Storage API must return a JSON object";
      if (persist) await run(env.DB, "UPDATE storage_servers SET last_status=?,last_error=?,last_checked_at=? WHERE id=?", "error", message, checkedAt, item.id);
      return { status: "error", message, usage: null, cameras: [], checked_at: checkedAt };
    }
    const parsed = parseStorageUsage(payload);
    const status = parsed.usage.total_bytes > 0 ? "online" : "warning";
    const message = status === "online" ? "Connected" : "Connected, but no capacity data was reported";
    if (persist) await run(env.DB, "UPDATE storage_servers SET last_status=?,last_error=?,last_checked_at=? WHERE id=?", status, status === "online" ? null : message, checkedAt, item.id);
    return { status, message, usage: parsed.usage, cameras: parsed.cameras, checked_at: checkedAt };
  } catch (error: any) {
    const message = error?.message || "Storage connection failed";
    if (persist) await run(env.DB, "UPDATE storage_servers SET last_status=?,last_error=?,last_checked_at=? WHERE id=?", "offline", message, checkedAt, item.id);
    return { status: "offline", message, usage: null, cameras: [], checked_at: checkedAt };
  }
};

const storageText = (...values: any[]): string => {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
};

const normalizeRecording = (entry: any, defaults: any = {}) => {
  const raw = typeof entry === "string" ? { filename: entry } : entry ?? {};
  const path = storageText(raw.path, raw.file_path, raw.file, raw.filename, raw.name, raw.id, defaults.path);
  const filename = storageText(raw.filename, raw.name, raw.file, path.split(/[\\/]/).pop()) || "Recording";
  const camera = storageText(raw.camera, raw.camera_name, raw.camera_id, defaults.camera, defaults.camera_name, defaults.camera_id) || "Camera1";
  const createdRaw = storageText(raw.created_at, raw.mtime, raw.timestamp);
  const date = storageText(raw.date, raw.day, defaults.date, defaults.day) || (createdRaw ? createdRaw.slice(0, 10) : new Date().toISOString().slice(0, 10));
  const numericCamera = Number(raw.camera_id ?? defaults.camera_id);
  const cameraId = Number.isFinite(numericCamera) && numericCamera > 0 ? numericCamera : null;
  const liveStyle = Boolean(storageText(raw.filename, raw.file, raw.name) && date && camera);
  const id = liveStyle ? `${camera}|${date}|${filename}` : storageText(raw.id, raw.file_id, path);
  return {
    id,
    camera_id: cameraId,
    camera,
    date,
    filename,
    name: filename,
    path,
    size_bytes: Number(raw.size_bytes ?? raw.size ?? raw.bytes ?? 0) || 0,
    created_at: createdRaw || (date ? `${date}T00:00:00.000Z` : null),
    duration_seconds: raw.duration_seconds ?? raw.duration ?? null,
    review_status: storageText(raw.review_status, defaults.review_status) || "unreviewed",
    reviewed_by: storageText(raw.reviewed_by, defaults.reviewed_by) || null,
    reviewed_at: storageText(raw.reviewed_at, defaults.reviewed_at) || null,
    mime_type: storageText(raw.mime_type, raw.content_type) || "video/mp4"
  };
};

const storageRecordings = (payload: any): any[] => {
  let items = payload;
  if (!Array.isArray(items)) {
    if (Array.isArray(payload?.files)) items = payload.files;
    else if (Array.isArray(payload?.recordings)) items = payload.recordings;
    else if (Array.isArray(payload?.items)) items = payload.items;
    else if (Array.isArray(payload?.data)) items = payload.data;
    else return [];
  }
  const defaults = Array.isArray(payload) ? {} : payload ?? {};
  return items.map((item: any) => normalizeRecording(item, defaults)).filter((item: any) => item.id);
};

const cameraKey = (value: any) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");

const storageRecordingViews = async (db: any, env: Env): Promise<any[]> => {
  const servers = await all(db, "SELECT * FROM storage_servers WHERE enabled=1 ORDER BY id");
  const cameraRows = await all(db, "SELECT id,name,host FROM cameras");
  const views: any[] = [];
  for (const server of servers) {
    try {
      const response = await storageFetch(env, server, "api/recordings");
      if (!response.ok) continue;
      const payload: any = await response.json().catch(() => ({}));
      for (const item of storageRecordings(payload)) {
        const key = cameraKey(item.camera);
        const matched = cameraRows.find((row: any) => cameraKey(row.name) === key || cameraKey(row.host) === key || cameraKey(`${row.name} ${row.host}`) === key);
        const startedAt = item.created_at || (item.date ? `${item.date}T${String(item.time ?? "00:00:00")}` : new Date().toISOString());
        views.push({
          id: -(views.length + 1),
          camera_id: Number(item.camera_id) > 0 ? Number(item.camera_id) : matched ? Number(matched.id) : null,
          camera: item.camera,
          name: item.name || item.filename,
          date: item.date,
          time: item.time ?? String(startedAt).slice(11, 19),
          path: item.path,
          filename: item.filename,
          started_at: startedAt,
          ended_at: null,
          duration_seconds: item.duration_seconds ?? null,
          size_bytes: Number(item.size_bytes ?? 0) || 0,
          review_status: item.review_status ?? "unreviewed",
          reviewed_by: item.reviewed_by ?? null,
          reviewed_at: item.reviewed_at ?? null,
          kind: "continuous",
          status: "ready",
          storage_server_id: Number(server.id),
          storage_recording_id: String(item.id),
          fileUrl: `/api/storage/servers/${Number(server.id)}/recordings/${encodeURIComponent(String(item.id))}/file`,
          downloadUrl: `/api/storage/servers/${Number(server.id)}/recordings/${encodeURIComponent(String(item.id))}/download`
        });
      }
    } catch {}
  }
  return views;
};

const storageServersRoute = async (request: Request, env: Env, parts: string[], method: string, user: any): Promise<Response> => {
  const db = env.DB;
  if (parts.length === 3) {
    if (method === "GET") return json((await all(db, "SELECT * FROM storage_servers ORDER BY id")).map(storageView));
    if (method === "POST") {
      const data = await bodyOf(request);
      const endpointRaw = String(data.endpoint ?? "").trim();
      const apiKey = String(data.api_key ?? data.secret ?? "");
      if (!/^https?:\/\/\S+$/i.test(endpointRaw)) return fail("Enter a valid http or https storage API URL", 422);
      if (!apiKey) return fail("API key is required", 422);
      if (apiKey.length > 500) return fail("API key is too long", 422);
      const endpoint = storageBaseUrl(endpointRaw);
      const authMethod = ["none", "bearer", "basic", "api_key"].includes(String(data.auth_method)) ? String(data.auth_method) : "bearer";
      await run(
        db,
        "INSERT INTO storage_servers (name,kind,endpoint,base_path,bucket,region,auth_method,secret_enc,enabled,last_status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        String(data.name ?? "").trim() || "Ubuntu Storage",
        "remote_api",
        endpoint,
        null,
        null,
        null,
        authMethod,
        await encryptSecret(apiKey, env.ENCRYPTION_KEY || env.SECRET_KEY),
        data.enabled === false ? 0 : 1,
        "unknown",
        stamp(),
        stamp()
      );
      const created = await first(db, "SELECT * FROM storage_servers ORDER BY id DESC LIMIT 1");
      const probe = await probeStorage(env, created, true);
      await audit(request, env, user, "storage.created", String(created.id));
      return json({ ...storageView(created), probe }, 201);
    }
  }
  const id = Number(parts[3]);
  const item = await first(db, "SELECT * FROM storage_servers WHERE id=?", id);
  if (!item) return fail("Storage server not found", 404);

  if (parts[4] === "test" && method === "POST") {
    const probe = await probeStorage(env, item, true);
    await audit(request, env, user, "storage.tested", String(id));
    return json(probe);
  }

  if (parts[4] === "recordings" && method === "GET" && !parts[5]) {
    try {
      const response = await storageFetch(env, item, "api/recordings");
      const text = await response.text();
      if (!response.ok) return fail(`Storage API returned HTTP ${response.status}: ${text.slice(0, 500)}`, 502);
      let payload: any;
      try {
        payload = JSON.parse(text);
      } catch {
        return fail("Storage API did not return valid recording JSON", 502);
      }
      return json(storageRecordings(payload));
    } catch (error: any) {
      return fail(error?.message || "Could not load recordings", 502);
    }
  }

  if (parts[4] === "recordings" && parts[5] && ["file", "download"].includes(parts[6]) && method === "GET") {
    const fileId = decodeURIComponent(parts[5]);
    const liveParts = fileId.split("|");
    const liveStyle = liveParts.length === 3;
    const primaryPath = liveStyle
      ? `api/recordings/file/${encodeURIComponent(liveParts[0])}/${encodeURIComponent(liveParts[1])}/${encodeURIComponent(liveParts[2])}`
      : `api/recordings/${encodeURIComponent(fileId)}/${parts[6]}`;
    const range = request.headers.get("range");
    try {
      let response = await storageFetch(env, item, primaryPath, { headers: range ? { Range: range } : {} });
      if (liveStyle && response.status === 404) {
        if (response.body) await response.body.cancel().catch(() => {});
        response = await storageFetch(env, item, `${primaryPath}/${parts[6]}`, { headers: range ? { Range: range } : {} });
      }
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        return fail(`Storage API returned HTTP ${response.status}: ${detail.slice(0, 500)}`, 502);
      }
      const headers: Record<string, string> = { "cache-control": "no-store" };
      for (const key of ["content-type", "content-length", "content-range", "accept-ranges", "content-disposition"]) {
        const value = response.headers.get(key);
        if (value) headers[key] = value;
      }
      if (parts[6] === "download" && !headers["content-disposition"]) {
        headers["content-disposition"] = `attachment; filename="${(liveStyle ? liveParts[2] : fileId).replace(/"/g, "")}"`;
      }
      return new Response(response.body, { status: response.status, headers });
    } catch (error: any) {
      return fail(error?.message || "Could not stream recording", 502);
    }
  }

  if (parts[4] === "recordings" && parts[5] && parts[6] === "review" && ["POST", "PATCH", "PUT"].includes(method)) {
    const fileId = decodeURIComponent(parts[5]);
    const data = await bodyOf(request);
    try {
      const response = await storageFetch(env, item, `api/recordings/${encodeURIComponent(fileId)}/review`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      });
      const text = await response.text();
      if (!response.ok) return fail(`Storage API returned HTTP ${response.status}: ${text.slice(0, 500)}`, 502);
      return json(text ? JSON.parse(text) : { ok: true });
    } catch (error: any) {
      return fail(error?.message || "Could not save recording review", 502);
    }
  }

  if (parts[4] === "recordings" && parts[5] && method === "DELETE") {
    const fileId = decodeURIComponent(parts[5]);
    try {
      const response = await storageFetch(env, item, `api/recordings/${encodeURIComponent(fileId)}`, { method: "DELETE" });
      if (!response.ok && response.status !== 404) {
        const detail = await response.text().catch(() => "");
        return fail(`Storage API returned HTTP ${response.status}: ${detail.slice(0, 500)}`, 502);
      }
      await audit(request, env, user, "storage.recording.deleted", fileId, null);
      return empty();
    } catch (error: any) {
      return fail(error?.message || "Could not delete stored recording", 502);
    }
  }

  if (parts[4] === "upload" && method === "POST") {
    try {
      const form = await request.formData();
      const file = form.get("file");
      if (!file || typeof file === "string") return fail("Choose a file to upload", 422);
      const camera = String(form.get("camera") ?? form.get("camera_id") ?? "Camera1").trim() || "Camera1";
      const date = String(form.get("date") ?? "").trim() || new Date().toISOString().slice(0, 10);
      const payload = new FormData();
      payload.append("file", file, file.name);
      payload.append("camera", camera);
      payload.append("date", date);
      const response = await storageFetch(env, item, "api/storage/upload", { method: "POST", body: payload });
      const text = await response.text();
      if (!response.ok) return fail(`Storage API returned HTTP ${response.status}: ${text.slice(0, 500)}`, 502);
      let saved: any;
      try { saved = JSON.parse(text); } catch { return fail("Storage API did not return valid upload JSON", 502); }
      const recording = normalizeRecording(saved.record ?? saved.file ?? saved, { camera, date });
      await audit(request, env, user, "storage.uploaded", String(id));
      return json({ ...recording, server_id: id, server_name: item.name, fileUrl: `/api/storage/servers/${id}/recordings/${encodeURIComponent(recording.id)}/file`, downloadUrl: `/api/storage/servers/${id}/recordings/${encodeURIComponent(recording.id)}/download` }, 201);
    } catch (error: any) {
      return fail(error?.message || "Could not upload file", 502);
    }
  }

  if (parts.length === 4 && method === "PATCH") {
    const data = await bodyOf(request);
    const fields: Record<string, any> = {};
    if ("name" in data) fields.name = String(data.name);
    if ("endpoint" in data) {
      const endpoint = String(data.endpoint ?? "").trim();
      if (!/^https?:\/\/\S+$/i.test(endpoint)) return fail("Enter a valid http or https storage API URL", 422);
      fields.endpoint = storageBaseUrl(endpoint);
    }
    if ("enabled" in data) fields.enabled = data.enabled ? 1 : 0;
    if ("auth_method" in data) {
      const authMethod = String(data.auth_method);
      if (!["none", "bearer", "basic", "api_key"].includes(authMethod)) return fail("Unsupported storage authentication method", 422);
      fields.auth_method = authMethod;
    }
    const apiKey = String(data.api_key ?? data.secret ?? "");
    if (apiKey) {
      if (apiKey.length > 500) return fail("API key is too long", 422);
      fields.secret_enc = await encryptSecret(apiKey, env.ENCRYPTION_KEY || env.SECRET_KEY);
    }
    fields.last_status = "unknown";
    const keys = Object.keys(fields);
    if (keys.length) await run(db, `UPDATE storage_servers SET ${keys.map((key) => `${key}=?`).join(",")}, updated_at=? WHERE id=?`, ...keys.map((key) => fields[key]), stamp(), id);
    return json(storageView(await first(db, "SELECT * FROM storage_servers WHERE id=?", id)));
  }
  if (parts.length === 4 && method === "DELETE") {
    await run(db, "DELETE FROM storage_servers WHERE id=?", id);
    await audit(request, env, user, "storage.deleted", String(id));
    return empty();
  }
  return fail("Not found", 404);
};

const storageOverview = async (env: Env): Promise<Response> => {
  const rows = await all(env.DB, "SELECT * FROM storage_servers ORDER BY id");
  const servers: any[] = [];
  const cameraUsage = new Map<number, any>();
  const recordings: any[] = [];
  const totals = { total_bytes: 0, used_bytes: 0, available_bytes: 0 };

  for (const row of rows) {
    const probe = row.enabled
      ? await probeStorage(env, row)
      : { status: "disabled", message: "Integration disabled", usage: null, cameras: [], checked_at: null };
    servers.push({
      ...storageView(row),
      connection: probe.status === "online" || probe.status === "warning" ? "Connected" : "Disconnected",
      probe
    });
    for (const item of probe.cameras) cameraUsage.set(Number(item.camera_id), item);
    if (probe.usage) {
      totals.total_bytes += probe.usage.total_bytes;
      totals.used_bytes += probe.usage.used_bytes;
      totals.available_bytes += probe.usage.available_bytes;
    }
    if (probe.status === "online" || probe.status === "warning") {
      try {
        const response = await storageFetch(env, row, "api/recordings");
        if (response.ok) {
          const payload: any = await response.json().catch(() => []);
          for (const recording of storageRecordings(payload)) {
            recordings.push({ ...recording, server_id: row.id, server_name: row.name, fileUrl: `/api/storage/servers/${row.id}/recordings/${encodeURIComponent(recording.id)}/file`, downloadUrl: `/api/storage/servers/${row.id}/recordings/${encodeURIComponent(recording.id)}/download` });
          }
        }
      } catch {}
    }
  }

  const cameraRows = await all(env.DB, "SELECT id,name,protocol,enabled FROM cameras ORDER BY id");
  const recordingCounts = new Map<number, number>();
  for (const recording of recordings) {
    if (recording.camera_id) recordingCounts.set(recording.camera_id, (recordingCounts.get(recording.camera_id) ?? 0) + 1);
  }
  const cameras = cameraRows.map((camera) => {
    const usage = cameraUsage.get(Number(camera.id));
    return {
      id: camera.id,
      name: camera.name,
      status: camera.enabled ? "configured" : "disabled",
      protocol: camera.protocol,
      owner: null,
      used_bytes: usage?.used_bytes ?? 0,
      recording_count: recordingCounts.get(Number(camera.id)) ?? 0,
      available_bytes: probeTotal(servers) - (usage?.used_bytes ?? 0),
      percent_used: probeTotal(servers) ? Math.round(((usage?.used_bytes ?? 0) / probeTotal(servers)) * 1000) / 10 : 0
    };
  });

  const combined = {
    total_bytes: totals.total_bytes,
    used_bytes: totals.used_bytes,
    available_bytes: totals.available_bytes,
    percent_used: totals.total_bytes ? Math.round((totals.used_bytes / totals.total_bytes) * 1000) / 10 : 0,
    source: "ubuntu-storage"
  };
  return json({
    local: zeroUsage("none"),
    servers,
    cameras,
    recordings,
    totals: combined,
    camera_count: cameraRows.length
  });
};

const SESSION_ONLINE_WINDOW_MS = 5 * 60 * 1000;

const latestStamp = (values: any[]) => values.filter(Boolean).sort((left, right) => toTime(right) - toTime(left))[0] ?? null;

const earliestStamp = (values: any[]) => values.filter(Boolean).sort((left, right) => toTime(left) - toTime(right))[0] ?? null;

const matchesDate = (value: any, date: string) => !date || String(value ?? "").startsWith(date);

const sessionIsOnline = (session: any) => {
  const expires = toTime(session.expires_at);
  const seen = toTime(session.last_seen_at ?? session.created_at);
  return (!expires || expires > Date.now()) && seen > 0 && seen >= Date.now() - SESSION_ONLINE_WINDOW_MS;
};

const cameraMonitorState = (camera: any, status: any) => {
  if (!camera.enabled) return "disabled";
  const value = String(status?.status ?? "").toLowerCase();
  if (value === "online" || value === "recording") return "online";
  if (value === "starting" || value === "reconnecting") return "connecting";
  return "offline";
};

const recordingMonitorState = (camera: any, status: any) => {
  if (!camera.recording_enabled) return "disabled";
  const value = String(status?.recording ?? "").toLowerCase();
  if (value === "recording") return "recording";
  if (value === "error") return "error";
  if (value === "starting" || value === "reconnecting") return value;
  return "stopped";
};

const monitoringFilters = (url: URL) => ({
  username: String(url.searchParams.get("username") ?? "").trim().toLowerCase(),
  date: String(url.searchParams.get("date") ?? "").trim(),
  session_state: String(url.searchParams.get("session_state") ?? "").trim().toLowerCase(),
  camera_state: String(url.searchParams.get("camera_state") ?? "").trim().toLowerCase(),
  recording_state: String(url.searchParams.get("recording_state") ?? "").trim().toLowerCase()
});

const bridgeCameraStatuses = async (env: Env) => {
  const statuses: Record<string, any> = {};
  const info = { status: "unavailable", config_loaded_at: null as any, config_error: null as any, error: null as any };
  if (env.MEDIA_BRIDGE_URL && env.MEDIA_BRIDGE_TOKEN) {
    try {
      const upstream = await bridgeFetch(env, "/status");
      if (upstream.ok) {
        const payload: any = await upstream.json().catch(() => ({}));
        for (const item of payload.cameras ?? []) statuses[String(item.camera_id ?? item.id)] = item;
        info.status = "online";
        info.config_loaded_at = payload.config_loaded_at ?? null;
        info.config_error = payload.config_error ?? null;
        return { statuses, info };
      }
      info.error = `Media bridge returned HTTP ${upstream.status}`;
    } catch (error: any) {
      info.error = error?.message || "Media bridge is unreachable";
    }
  } else {
    info.error = "Media bridge is not configured";
  }
  const cameras = await all(env.DB, "SELECT * FROM cameras WHERE enabled=1 ORDER BY id");
  const entries = await Promise.all(cameras.map(async (camera: any) => {
    try {
      const upstream = await cameraBridgeAction(env, camera, "/status");
      if (!upstream.ok) return { id: String(camera.id), status: null };
      return { id: String(camera.id), status: await upstream.json().catch(() => ({})) };
    } catch {
      return { id: String(camera.id), status: null };
    }
  }));
  for (const entry of entries) if (entry.status) statuses[entry.id] = entry.status;
  if (Object.keys(statuses).length) {
    info.status = "online";
    info.error = null;
  }
  return { statuses, info };
};

const systemHealthFrom = (bridge: any, storages: Array<{ row: any; probe: any }>) => {
  const cameraStatuses = Object.values(bridge?.statuses ?? {}) as any[];
  const bridgeOnline = bridge?.info?.status === "online";
  const recordingCameras = cameraStatuses.filter((item: any) => String(item?.recording ?? "").toLowerCase() === "recording").length;
  const streamingCameras = cameraStatuses.filter((item: any) => ["online", "recording", "starting"].includes(String(item?.status ?? "").toLowerCase())).length;
  const totals = { total_bytes: 0, used_bytes: 0, free_bytes: 0 };
  for (const { probe } of storages) {
    if (!probe?.usage) continue;
    totals.total_bytes += Number(probe.usage.total_bytes) || 0;
    totals.used_bytes += Number(probe.usage.used_bytes) || 0;
    totals.free_bytes += Number(probe.usage.available_bytes) || 0;
  }
  const connected = storages.find((item: any) => ["online", "warning"].includes(String(item?.probe?.status ?? "")));
  const storageDetail = connected
    ? `Connected to ${connected.row.name}`
    : storages.find((item: any) => item?.probe?.message)?.probe.message || "No storage integration is connected";
  return {
    api: "ok",
    media: bridgeOnline ? "ok" : "unavailable",
    recording: bridgeOnline ? "ok" : "unavailable",
    ai: "not_configured",
    cpu: null,
    ram: null,
    gpu: null,
    network: bridgeOnline ? "ok" : "unavailable",
    host: "cloudflare",
    storage: {
      ...totals,
      low: totals.total_bytes > 0 && totals.free_bytes / totals.total_bytes < 0.15
    },
    details: {
      api: "Edge API responding",
      media: bridgeOnline
        ? `Media bridge online · ${cameraStatuses.length} camera(s) reporting`
        : bridge?.info?.config_error || bridge?.info?.error || "Media bridge is unreachable",
      recording: bridgeOnline
        ? recordingCameras ? `${recordingCameras} camera(s) recording` : `Bridge online · ${streamingCameras} camera(s) streaming`
        : "Media bridge offline; recording state cannot be verified",
      ai: "No local AI worker is connected in this edge-only deployment",
      storage: storageDetail,
      host: "Cloudflare Workers do not expose host CPU/RAM counters"
    }
  };
};

const probeStorageServers = async (env: Env, rows: any[]) => Promise.all(rows.map(async (row: any) => ({
  row,
  probe: row.enabled
    ? await probeStorage(env, row)
    : { status: "disabled", message: "Integration disabled", usage: null, cameras: [], checked_at: null }
})));

const monitoringActivityView = (row: any) => ({
  id: row.id,
  user_id: row.user_id ?? null,
  username: row.username ?? null,
  action: row.action,
  target: row.target ?? "",
  camera_id: row.camera_id ?? null,
  ip: row.ip ?? "",
  created_at: row.created_at
});

const monitoringSessionView = (row: any, activeById: Map<string, any>) => {
  const active = activeById.get(String(row.id)) ?? null;
  return {
    id: String(row.id),
    user_id: Number(row.user_id),
    username: row.username ?? null,
    login_at: row.login_at,
    last_seen_at: latestStamp([row.last_seen_at, active?.last_seen_at]),
    logout_at: row.logout_at ?? null,
    end_reason: row.end_reason ?? null,
    expires_at: row.expires_at ?? null,
    ip: row.ip ?? "",
    user_agent: row.user_agent ?? "",
    active: !!active,
    online: active ? sessionIsOnline(active) : false
  };
};

const monitoringOverview = async (env: Env, url: URL, actor: any): Promise<Response> => {
  if (actor.role !== "admin") return fail("Administrator access required", 403);
  await sweepExpiredSessions(env);
  const filters = monitoringFilters(url);
  const [userRows, cameraRows, activeSessions, historyRows, auditRows, recordingRows, storageRows] = await Promise.all([
    all(env.DB, "SELECT * FROM users ORDER BY id"),
    all(env.DB, "SELECT * FROM cameras ORDER BY id"),
    all(env.DB, "SELECT * FROM sessions ORDER BY created_at DESC"),
    all(env.DB, "SELECT * FROM user_sessions_history ORDER BY login_at DESC LIMIT 500"),
    all(env.DB, "SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 500"),
    all(env.DB, "SELECT * FROM camera_recordings ORDER BY started_at DESC LIMIT 500"),
    all(env.DB, "SELECT * FROM storage_servers ORDER BY id")
  ]);
  const [bridge, storageProbes] = await Promise.all([
    bridgeCameraStatuses(env),
    probeStorageServers(env, storageRows)
  ]);
  const health = systemHealthFrom(bridge, storageProbes);
  const ownerById = new Map(userRows.map((row: any) => [Number(row.id), row]));
  const activeById = new Map(activeSessions.map((row: any) => [String(row.id), row]));
  const recordingsByCamera = new Map<number, any[]>();
  for (const recording of recordingRows) {
    const key = Number(recording.camera_id);
    const list = recordingsByCamera.get(key) ?? [];
    list.push(recording);
    recordingsByCamera.set(key, list);
  }
  for (const list of recordingsByCamera.values()) list.sort((left, right) => toTime(right.started_at) - toTime(left.started_at));

  const cameras = cameraRows.map((camera: any) => {
    const status = bridge.statuses[String(camera.id)] ?? null;
    const cameraRecordings = recordingsByCamera.get(Number(camera.id)) ?? [];
    const owner = ownerById.get(Number(camera.user_id));
    return {
      ...cameraView(camera),
      owner: owner?.username ?? "Unassigned",
      stream_state: cameraMonitorState(camera, status),
      recording_state: recordingMonitorState(camera, status),
      stream_status: status?.status ?? null,
      recording_status: status?.recording ?? null,
      last_error: status?.message || status?.recording_error || null,
      last_recording_at: latestStamp([status?.last_recording_at, cameraRecordings[0]?.started_at]),
      recording_count: cameraRecordings.length,
      recorded_bytes: cameraRecordings.reduce((sum: number, item: any) => sum + (Number(item.size_bytes) || 0), 0)
    };
  });
  const cameraStateById = new Map(cameras.map((camera: any) => [Number(camera.id), camera]));

  const users = userRows.map((user: any) => {
    const owned = cameras.filter((camera: any) => Number(camera.user_id) === Number(user.id));
    const active = activeSessions.filter((session: any) => Number(session.user_id) === Number(user.id));
    const history = historyRows.filter((row: any) => Number(row.user_id) === Number(user.id));
    const activity = auditRows.filter((row: any) => Number(row.user_id) === Number(user.id) || String(row.username ?? "").toLowerCase() === String(user.username ?? "").toLowerCase());
    return {
      ...userView(user),
      first_login_at: earliestStamp(history.map((row: any) => row.login_at)),
      last_seen_at: latestStamp([...history.map((row: any) => row.last_seen_at), ...active.map((session: any) => session.last_seen_at ?? session.created_at)]),
      online: active.some(sessionIsOnline),
      active_sessions: active.filter(sessionIsOnline).length,
      camera_count: owned.length,
      online_cameras: owned.filter((camera: any) => camera.stream_state === "online").length,
      recording_cameras: owned.filter((camera: any) => camera.recording_state === "recording").length,
      recording_count: owned.reduce((sum: number, camera: any) => sum + camera.recording_count, 0),
      audit_count: activity.length
    };
  });

  const matchesUser = (username: any) => !filters.username || String(username ?? "").toLowerCase().includes(filters.username);
  const activity = auditRows.map(monitoringActivityView).filter((row: any) => matchesUser(row.username) && matchesDate(row.created_at, filters.date));
  const sessions = historyRows.map((row: any) => monitoringSessionView(row, activeById)).filter((row: any) => {
    if (!matchesUser(row.username)) return false;
    if (!matchesDate(row.login_at, filters.date) && !matchesDate(row.last_seen_at, filters.date)) return false;
    if (filters.session_state === "online" && !row.online) return false;
    if (filters.session_state === "active" && !row.active) return false;
    if (filters.session_state === "offline" && row.online) return false;
    if (filters.session_state === "closed" && row.active) return false;
    return true;
  });
  const filteredCameras = cameras.filter((camera: any) => {
    if (!matchesUser(camera.owner)) return false;
    if (!matchesDate(camera.created_at, filters.date) && !matchesDate(camera.last_recording_at, filters.date)) return false;
    if (filters.camera_state && camera.stream_state !== filters.camera_state) return false;
    if (filters.recording_state && camera.recording_state !== filters.recording_state) return false;
    return true;
  });
  const filteredUsers = users.filter((user: any) => {
    if (!matchesUser(user.username)) return false;
    if (!matchesDate(user.created_at, filters.date) && !matchesDate(user.first_login_at, filters.date) && !matchesDate(user.last_seen_at, filters.date)) return false;
    if (filters.session_state === "online" && !user.online) return false;
    if (filters.session_state === "offline" && user.online) return false;
    const owned = cameras.filter((camera: any) => Number(camera.user_id) === Number(user.id));
    if (filters.camera_state && !owned.some((camera: any) => camera.stream_state === filters.camera_state)) return false;
    if (filters.recording_state && !owned.some((camera: any) => camera.recording_state === filters.recording_state)) return false;
    return true;
  });
  const recordings = recordingRows.map((row: any) => {
    const camera = cameraStateById.get(Number(row.camera_id));
    return {
      ...recordingView(row),
      owner: camera?.owner ?? "Unassigned",
      stream_state: camera?.stream_state ?? "offline",
      recording_state: camera?.recording_state ?? "stopped"
    };
  }).filter((row: any) => {
    if (!matchesUser(row.owner)) return false;
    if (!matchesDate(row.started_at, filters.date)) return false;
    if (filters.camera_state && row.stream_state !== filters.camera_state) return false;
    if (filters.recording_state && row.recording_state !== filters.recording_state) return false;
    return true;
  });
  const today = new Date().toISOString().slice(0, 10);
  const recordedBytes = recordingRows.reduce((sum: number, row: any) => sum + (Number(row.size_bytes) || 0), 0);
  const summary = {
    accounts: userRows.length,
    online_users: new Set(activeSessions.filter(sessionIsOnline).map((session: any) => Number(session.user_id))).size,
    active_sessions: activeSessions.filter(sessionIsOnline).length,
    cameras: cameraRows.length,
    online_cameras: cameras.filter((camera: any) => camera.stream_state === "online").length,
    recording_cameras: cameras.filter((camera: any) => camera.recording_state === "recording").length,
    recordings_total: recordingRows.length,
    recordings_today: recordingRows.filter((row: any) => matchesDate(row.started_at, today)).length,
    recorded_bytes: recordedBytes
  };
  return json({
    generated_at: stamp(),
    filters,
    summary,
    health,
    bridge: bridge.info,
    storage: {
      recorded_bytes: recordedBytes,
      servers: storageRows.map(storageView)
    },
    users,
    cameras: filteredCameras,
    sessions,
    activity,
    recordings
  });
};

const monitoringUserDetail = async (env: Env, id: number): Promise<Response> => {
  await sweepExpiredSessions(env);
  const user = await first(env.DB, "SELECT * FROM users WHERE id=?", id);
  if (!user) return fail("User not found", 404);
  const [activeSessions, historyRows, auditRows, ownedCameras] = await Promise.all([
    all(env.DB, "SELECT * FROM sessions WHERE user_id=? ORDER BY created_at DESC", id),
    all(env.DB, "SELECT * FROM user_sessions_history WHERE user_id=? ORDER BY login_at DESC LIMIT 200", id),
    all(env.DB, "SELECT * FROM audit_logs WHERE user_id=? OR username=? ORDER BY created_at DESC LIMIT 200", id, user.username),
    all(env.DB, "SELECT * FROM cameras WHERE user_id=? ORDER BY id", id)
  ]);
  const cameraIds = ownedCameras.map((camera: any) => Number(camera.id));
  const placeholders = cameraIds.length ? cameraIds.map(() => "?").join(",") : "NULL";
  const [recordings, events] = cameraIds.length
    ? await Promise.all([
      all(env.DB, `SELECT * FROM camera_recordings WHERE camera_id IN (${placeholders}) ORDER BY started_at DESC LIMIT 200`, ...cameraIds),
      all(env.DB, `SELECT * FROM events WHERE camera_id IN (${placeholders}) ORDER BY occurred_at DESC LIMIT 200`, ...cameraIds)
    ])
    : [[], []];
  const activeById = new Map(activeSessions.map((row: any) => [String(row.id), row]));
  const lastSeen = latestStamp([...historyRows.map((row: any) => row.last_seen_at), ...activeSessions.map((row: any) => row.last_seen_at ?? row.created_at)]);
  return json({
    user: userView(user),
    summary: {
      first_login_at: latestStamp(historyRows.map((row: any) => row.login_at).reverse()),
      last_seen_at: lastSeen,
      active_sessions: activeSessions.filter(sessionIsOnline).length,
      total_sessions: historyRows.length,
      cameras: ownedCameras.length,
      recordings: recordings.length,
      events: events.length,
      audit_actions: auditRows.length
    },
    sessions: historyRows.map((row: any) => monitoringSessionView(row, activeById)),
    activity: auditRows.map(monitoringActivityView),
    cameras: ownedCameras.map(cameraView),
    recordings: recordings.map(recordingView),
    events: events.map(eventView)
  });
};

const monitoringRoute = async (request: Request, env: Env, parts: string[], method: string, url: URL, actor: any): Promise<Response> => {
  if (actor.role !== "admin") return fail("Administrator access required", 403);
  if (method === "GET" && (parts.length === 3 || (parts.length === 4 && parts[3] === "overview"))) return monitoringOverview(env, url, actor);
  if (method === "GET" && parts.length === 5 && parts[3] === "users") return monitoringUserDetail(env, Number(parts[4]));
  return fail("Not found", 404);
};

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (character) => `\\${character}`);

const aiDefaults = {
  detection_confidence: 0.55,
  motion_threshold: 12,
  frame_interval_ms: 5000,
  max_objects: 5,
  surveillance_enabled: true,
  alert_severity: "warning",
  notify_webhooks: true,
  voice_enabled: true,
  person_only: false
};

const parseSettingValue = (raw: any): any => {
  try { return JSON.parse(String(raw)); } catch { return String(raw); }
};

const aiSettingsFor = async (db: any, cameraId?: number | null): Promise<Record<string, any>> => {
  const rows = await all(db, "SELECT * FROM ai_settings WHERE enabled=1 AND (camera_id IS NULL OR camera_id=?) ORDER BY camera_id, id", cameraId ?? -1);
  const settings: Record<string, any> = { ...aiDefaults };
  for (const row of rows) settings[row.key] = parseSettingValue(row.value);
  return settings;
};

const upsertAiSettings = async (db: any, settings: Record<string, any>, cameraId: number | null) => {
  const keys = Object.keys(aiDefaults).filter((key) => key in settings);
  for (const key of keys) {
    const value = JSON.stringify(settings[key]);
    const existing = await first(db, "SELECT id FROM ai_settings WHERE key=? AND camera_id IS ?", key, cameraId);
    if (existing) await run(db, "UPDATE ai_settings SET value=?,enabled=1,updated_at=? WHERE id=?", value, stamp(), existing.id);
    else await run(db, "INSERT INTO ai_settings (camera_id,key,value,enabled,updated_at) VALUES (?,?,?,?,?)", cameraId, key, value, 1, stamp());
  }
};

const aiSettingsRoute = async (request: Request, env: Env, url: URL, method: string, user: any): Promise<Response> => {
  const cameraIdRaw = url.searchParams.get("camera_id");
  const cameraId = cameraIdRaw ? Number(cameraIdRaw) : null;
  if (cameraId !== null) {
    const access = await cameraFor(env.DB, user, cameraId, method === "GET" ? "view" : "manage");
    if (access instanceof Response) return access;
  }
  if (method === "GET") {
    const rows = await all(env.DB, "SELECT * FROM ai_settings WHERE camera_id IS NULL OR camera_id=? ORDER BY camera_id,id", cameraId ?? -1);
    return json({
      settings: await aiSettingsFor(env.DB, cameraId),
      rows: rows.map((row: any) => ({ id: Number(row.id), camera_id: row.camera_id ? Number(row.camera_id) : null, key: row.key, value: parseSettingValue(row.value), enabled: !!row.enabled, updated_at: row.updated_at }))
    });
  }
  if (method === "POST" || method === "PUT") {
    if (cameraId === null && !isAdmin(user)) return fail("Administrator access is required for global AI settings", 403);
    const data = await bodyOf(request);
    const settings = data.settings ?? data;
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) return fail("AI settings must be an object", 422);
    const allowed: Record<string, any> = {};
    for (const key of Object.keys(aiDefaults)) if (key in settings) allowed[key] = settings[key];
    await upsertAiSettings(env.DB, allowed, cameraId);
    await audit(request, env, user, "ai.settings_updated", cameraId ? String(cameraId) : "global", cameraId ?? null);
    return json({ settings: await aiSettingsFor(env.DB, cameraId) });
  }
  return fail("Not found", 404);
};

const notifyIntegrations = async (env: Env, alert: any) => {
  const integrations = await all(env.DB, "SELECT * FROM integrations WHERE enabled=1 AND endpoint<>'' ORDER BY id");
  for (const item of integrations) {
    try {
      const secret = await decryptSecret(item.secret_enc, env.ENCRYPTION_KEY || env.SECRET_KEY);
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (item.auth_method === "bearer" && secret) headers.Authorization = `Bearer ${secret}`;
      else if (item.auth_method === "basic" && secret) headers.Authorization = `Basic ${secret}`;
      else if (item.auth_method === "api_key" && secret) headers["X-API-Key"] = secret;
      else if (secret) headers["X-API-Key"] = secret;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      try {
        await fetch(String(item.endpoint), {
          method: "POST",
          headers,
          body: JSON.stringify({ type: "alert", event: "alert", alert }),
          signal: controller.signal
        });
      } finally {
        clearTimeout(timer);
      }
    } catch {}
  }
};

const bridgeEventIngest = async (request: Request, env: Env): Promise<Response> => {
  const data = await bodyOf(request);
  const cameraId = Number(data.camera_id);
  if (!Number.isFinite(cameraId) || cameraId <= 0) return fail("camera_id is required", 422);
  const camera = await first(env.DB, "SELECT * FROM cameras WHERE id=?", cameraId);
  if (!camera || !camera.enabled) return fail("Camera not found or disabled", 404);
  const settings = await aiSettingsFor(env.DB, cameraId);
  const occurredAt = String(data.occurred_at ?? stamp());
  const objectName = String(data.object_name ?? data.kind ?? "object");
  const confidence = Math.min(1, Math.max(0, Number(data.confidence ?? 0)));
  const snapshotPath = String(data.snapshot_path ?? "").trim();
  const duplicate = await first(
    env.DB,
    "SELECT id FROM events WHERE camera_id=? AND occurred_at=? AND object_name=? AND snapshot_path=? LIMIT 1",
    cameraId,
    occurredAt,
    objectName,
    snapshotPath
  );
  if (duplicate) return json({ event_id: Number(duplicate.id), duplicate: true });
  const snapshotUrl = snapshotPath
    ? `/api/ai/snapshot?camera_id=${cameraId}&path=${encodeURIComponent(snapshotPath)}`
    : null;
  const description = String(data.description ?? `${objectName} detected with ${Math.round(confidence * 100)}% confidence`);
  await run(
    env.DB,
    "INSERT INTO events (camera_id,kind,object_name,confidence,occurred_at,snapshot_path,snapshot_url,clip_path,clip_url,description,track_id,bounding_box,duration_seconds) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
    cameraId,
    String(data.kind ?? "detection"),
    objectName,
    confidence,
    occurredAt,
    snapshotPath || null,
    snapshotUrl,
    data.clip_path ? String(data.clip_path) : null,
    data.clip_url ? String(data.clip_url) : null,
    description,
    data.track_id ? String(data.track_id) : null,
    data.bounding_box ? JSON.stringify(data.bounding_box) : null,
    data.duration_seconds === undefined || data.duration_seconds === null ? null : Number(data.duration_seconds)
  );
  const saved = await first(env.DB, "SELECT * FROM events ORDER BY id DESC LIMIT 1");
  let alertId: number | null = null;
  const severity = String(data.severity ?? settings.alert_severity ?? "warning");
  if (data.alert !== false && severity !== "none") {
    await run(
      env.DB,
      "INSERT INTO alerts (camera_id,kind,message,severity,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
      cameraId,
      String(data.kind ?? "detection"),
      description,
      severity,
      "new",
      stamp(),
      stamp()
    );
    const savedAlert = await first(env.DB, "SELECT * FROM alerts ORDER BY id DESC LIMIT 1");
    alertId = savedAlert ? Number(savedAlert.id) : null;
    if (savedAlert && settings.notify_webhooks !== false) {
      await notifyIntegrations(env, alertView({ ...savedAlert, camera_name: camera.name }));
    }
  }
  if (objectName.toLowerCase().includes("person")) {
    await closeStalePersonSessions(env.DB, 90, occurredAt);
    const recent = await first(env.DB, "SELECT * FROM person_sessions WHERE camera_id=? AND status='active' ORDER BY last_seen_at DESC LIMIT 1", cameraId);
    const recentMs = recent ? Date.parse(recent.last_seen_at) : NaN;
    const occurredMs = Date.parse(occurredAt) || Date.now();
    if (recent && Number.isFinite(recentMs) && occurredMs - recentMs <= 90000) {
      await run(env.DB, "UPDATE person_sessions SET last_seen_at=?, activity=?, snapshot_path=?, updated_at=? WHERE id=?", occurredAt, description, snapshotPath || recent.snapshot_path, stamp(), recent.id);
    } else {
      await run(env.DB, "INSERT INTO person_sessions (camera_id, session_key, object_name, entry_at, last_seen_at, status, activity, snapshot_path, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)", cameraId, `${cameraId}-${occurredAt}-${Math.random().toString(36).slice(2, 8)}`, "person", occurredAt, occurredAt, "active", description, snapshotPath || null, stamp(), stamp());
    }
  }
  return json({ event_id: Number(saved?.id ?? 0), alert_id: alertId, snapshot_url: snapshotUrl }, 201);
};

const aiSnapshotRoute = async (request: Request, env: Env, url: URL, user: any): Promise<Response> => {
  const cameraId = Number(url.searchParams.get("camera_id"));
  const access = await cameraFor(env.DB, user, cameraId, "view");
  if (access instanceof Response) return access;
  const path = String(url.searchParams.get("path") ?? "").trim();
  if (!path || path.includes("..") || /^[a-z]+:\/\//i.test(path) || !/^[A-Za-z0-9_./-]+$/.test(path)) return fail("Invalid snapshot path", 422);
  const server = await first(env.DB, "SELECT * FROM storage_servers WHERE enabled=1 AND endpoint<>'' ORDER BY id LIMIT 1");
  if (!server) return fail("No storage server is configured", 404);
  try {
    const target = `api/storage/ai/snapshot?path=${encodeURIComponent(path)}`;
    const upstream = await storageFetch(env, server, target, { headers: { Accept: "image/jpeg" } });
    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => "");
      return fail(`Storage API returned HTTP ${upstream.status}: ${detail.slice(0, 300)}`, 502);
    }
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "content-type": upstream.headers.get("content-type") || "image/jpeg",
        "cache-control": "private, max-age=60"
      }
    });
  } catch (error: any) {
    return fail(error?.message || "Could not load snapshot", 502);
  }
};

const aiStatusPayload = async (env: Env, user: any) => {
  const ids = await accessibleCameraIds(env.DB, user);
  const filter = cameraFilterSql(ids, [], "camera_id", isAdmin(user));
  const [events, alerts, cameras] = await Promise.all([
    all(env.DB, `SELECT * FROM events WHERE 1=1${filter} ORDER BY occurred_at DESC LIMIT 200`, ...([] as any[]).concat(ids)),
    all(env.DB, `SELECT * FROM alerts WHERE 1=1${filter} ORDER BY created_at DESC LIMIT 200`, ...([] as any[]).concat(ids)),
    all(env.DB, `SELECT * FROM cameras WHERE 1=1${cameraFilterSql(ids, [], "id")} ORDER BY id`, ...([] as any[]).concat(ids))
  ]);
  let bridge: any = {};
  let error: string | null = null;
  try {
    const response = await bridgeFetch(env, "/ai/status");
    if (!response.ok) throw new Error(`Local AI bridge returned HTTP ${response.status}`);
    bridge = await response.json().catch(() => ({}));
  } catch (caught: any) {
    error = caught?.message || "Local AI bridge is unreachable";
  }
  return {
    active: bridge.running ? "hybrid-detector" : "none",
    provider: bridge.detector?.provider || "local_hybrid",
    model: bridge.detector?.active || bridge.detector?.model || "local-detector",
    status: bridge.running ? "running" : "stopped",
    local_only: true,
    error: error ?? bridge.error ?? null,
    detector: bridge.detector ?? null,
    models: bridge.models ?? [],
    cameras: bridge.cameras ?? {},
    fps: bridge.fps ?? null,
    last_frame_at: bridge.last_frame_at ?? null,
    counts: {
      cameras: cameras.length,
      events: events.length,
      alerts: alerts.length,
      new_alerts: alerts.filter((alert: any) => String(alert.status) === "new").length
    },
    recent_events: events.slice(0, 10).map(eventView),
    recent_alerts: alerts.slice(0, 10).map(alertView)
  };
};

const aiModelsRoute = async (env: Env): Promise<Response> => {
  try {
    const response = await bridgeFetch(env, "/ai/models");
    if (!response.ok) throw new Error(`Local AI bridge returned HTTP ${response.status}`);
    const payload: any = await response.json().catch(() => ({}));
    return json({ models: Array.isArray(payload.models) ? payload.models : [] });
  } catch (error: any) {
    return json({ models: [], error: error?.message || "Local AI bridge is unreachable" }, 502);
  }
};

const aiAskRoute = async (request: Request, env: Env, user: any): Promise<Response> => {
  const data = await bodyOf(request);
  const question = String(data.question ?? data.message ?? "").trim();
  if (!question) return fail("Question is required", 422);
  const ids = await accessibleCameraIds(env.DB, user);
  const eventParams: any[] = [];
  const alertParams: any[] = [];
  const eventFilter = cameraFilterSql(ids, eventParams, "e.camera_id", isAdmin(user));
  const alertFilter = cameraFilterSql(ids, alertParams, "a.camera_id", isAdmin(user));
  const [events, alerts] = await Promise.all([
    all(env.DB, `SELECT e.*, c.name AS camera_name FROM events e LEFT JOIN cameras c ON c.id=e.camera_id WHERE 1=1${eventFilter} ORDER BY e.occurred_at DESC LIMIT 12`, ...eventParams),
    all(env.DB, `SELECT a.*, c.name AS camera_name FROM alerts a LEFT JOIN cameras c ON c.id=a.camera_id WHERE 1=1${alertFilter} ORDER BY a.created_at DESC LIMIT 12`, ...alertParams)
  ]);
  const context = [
    ...events.map((event: any) => `EVENT ${event.occurred_at} ${event.camera_name ?? `camera ${event.camera_id}`}: ${event.description ?? `${event.object_name} ${event.confidence ?? ""}`}`),
    ...alerts.map((alert: any) => `ALERT ${alert.created_at} ${alert.camera_name ?? `camera ${alert.camera_id}`} [${alert.severity}/${alert.status}]: ${alert.message}`)
  ];
  try {
    const response = await bridgeFetch(env, "/ai/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: question, context, history: Array.isArray(data.history) ? data.history : [] })
    });
    const payload: any = await response.json().catch(() => ({}));
    if (!response.ok) return fail(payload.error || payload.detail || `Local AI bridge returned HTTP ${response.status}`, 502);
    return json({ answer: String(payload.answer ?? payload.message ?? ""), model: payload.model ?? null });
  } catch (error: any) {
    return fail(error?.message || "Local AI assistant is unreachable", 502);
  }
};

const surveillanceRoute = async (request: Request, env: Env, parts: string[], method: string, user: any): Promise<Response> => {
  if (method === "GET" && (parts.length === 2 || (parts.length === 3 && parts[2] === "status"))) {
    return json(await aiStatusPayload(env, user));
  }
  if (method === "POST" && parts.length === 3 && ["start", "stop"].includes(parts[2])) {
    const data = await bodyOf(request);
    const cameraId = data.camera_id ? Number(data.camera_id) : null;
    if (cameraId !== null) {
      const access = await cameraFor(env.DB, user, cameraId, "manage");
      if (access instanceof Response) return access;
    } else if (!isAdmin(user) && !isOperator(user)) {
      return fail("Administrator or operator access required", 403);
    }
    await upsertAiSettings(env.DB, { surveillance_enabled: parts[2] === "start" }, cameraId);
    await audit(request, env, user, `surveillance.${parts[2]}`, cameraId ? String(cameraId) : "all", cameraId ?? null);
    try {
      const response = await bridgeFetch(env, `/ai/${parts[2]}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ camera_id: cameraId })
      });
      const payload: any = await response.json().catch(() => ({}));
      if (!response.ok) return fail(payload.error || payload.detail || `Local AI bridge returned HTTP ${response.status}`, 502);
      return json(payload);
    } catch (error: any) {
      return fail(error?.message || "Local AI bridge is unreachable", 502);
    }
  }
  return fail("Not found", 404);
};

const eventsRoute = async (env: Env, url: URL, user: any, detectionsOnly = false) => {
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
  const pageSize = Math.max(1, Number(url.searchParams.get("page_size") ?? 25));
  const ids = await accessibleCameraIds(env.DB, user);
  const params: any[] = [];
  let sql = "SELECT e.*, c.name AS camera_name FROM events e LEFT JOIN cameras c ON c.id=e.camera_id WHERE 1=1";
  sql += cameraFilterSql(ids, params, "e.camera_id", isAdmin(user));
  if (detectionsOnly) sql += " AND e.kind='detection'";
  const cameraId = url.searchParams.get("camera_id");
  if (cameraId) {
    const requested = Number(cameraId);
    if (!ids.includes(requested)) return { items: [], page, page_size: pageSize };
    sql += " AND e.camera_id=?";
    params.push(requested);
  }
  const kind = String(url.searchParams.get("kind") ?? "").trim();
  if (kind) { sql += " AND e.kind=?"; params.push(kind); }
  const objectName = String(url.searchParams.get("object_name") ?? "").trim();
  if (objectName) { sql += " AND e.object_name LIKE ? ESCAPE '\\'"; params.push(`%${escapeLike(objectName)}%`); }
  const search = String(url.searchParams.get("search") ?? "").trim();
  if (search) { sql += " AND (e.description LIKE ? ESCAPE '\\' OR e.object_name LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\')"; const term = `%${escapeLike(search)}%`; params.push(term, term, term); }
  const start = String(url.searchParams.get("start") ?? "").trim();
  if (start) { sql += " AND e.occurred_at>=?"; params.push(start); }
  const end = String(url.searchParams.get("end") ?? "").trim();
  if (end) { sql += " AND e.occurred_at<=?"; params.push(end); }
  const minConfidence = Number(url.searchParams.get("min_confidence"));
  if (Number.isFinite(minConfidence) && minConfidence > 0) { sql += " AND e.confidence>=?"; params.push(minConfidence); }
  sql += " ORDER BY e.occurred_at DESC LIMIT ? OFFSET ?";
  params.push(pageSize, (page - 1) * pageSize);
  const items = (await all(env.DB, sql, ...params)).map(eventView);
  return { items, page, page_size: pageSize };
};

const closeStalePersonSessions = async (db: any, timeoutSeconds: number, now: string) => {
  const nowMs = Date.parse(now) || Date.now();
  const rows = await all(db, "SELECT * FROM person_sessions WHERE status='active'");
  for (const row of rows) {
    const lastMs = Date.parse(row.last_seen_at);
    if (Number.isFinite(lastMs) && nowMs - lastMs > timeoutSeconds * 1000) {
      const duration = Math.max(0, (lastMs - Date.parse(row.entry_at)) / 1000);
      await run(db, "UPDATE person_sessions SET status='completed', exit_at=?, duration_seconds=?, updated_at=? WHERE id=?", row.last_seen_at, duration, now, row.id);
    }
  }
};

const personSessionsRoute = async (request: Request, env: Env, parts: string[], method: string, url: URL, user: any): Promise<Response> => {
  await closeStalePersonSessions(env.DB, 90, new Date().toISOString());
  const ids = await accessibleCameraIds(env.DB, user);
  if (parts.length === 2 && method === "GET") {
    const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
    const pageSize = Math.max(1, Number(url.searchParams.get("page_size") ?? 50));
    const params: any[] = [];
    let sql = "SELECT s.*, c.name AS camera_name FROM person_sessions s LEFT JOIN cameras c ON c.id=s.camera_id WHERE 1=1";
    sql += cameraFilterSql(ids, params, "s.camera_id", isAdmin(user));
    const cameraId = url.searchParams.get("camera_id");
    if (cameraId) {
      const requested = Number(cameraId);
      if (!ids.includes(requested)) return json({ items: [], page, page_size: pageSize });
      sql += " AND s.camera_id=?";
      params.push(requested);
    }
    const status = String(url.searchParams.get("status") ?? "").trim().toLowerCase();
    if (["active", "completed"].includes(status)) { sql += " AND s.status=?"; params.push(status); }
    const start = String(url.searchParams.get("start") ?? "").trim();
    if (start) { sql += " AND s.entry_at>=?"; params.push(start); }
    const end = String(url.searchParams.get("end") ?? "").trim();
    if (end) { sql += " AND s.entry_at<=?"; params.push(end); }
    const search = String(url.searchParams.get("search") ?? "").trim();
    if (search) { sql += " AND (s.activity LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\')"; const term = `%${escapeLike(search)}%`; params.push(term, term); }
    sql += " ORDER BY s.entry_at DESC LIMIT ? OFFSET ?";
    params.push(pageSize, (page - 1) * pageSize);
    const items = (await all(env.DB, sql, ...params)).map(personSessionView);
    return json({ items, page, page_size: pageSize });
  }
  const id = Number(parts[2]);
  if (Number.isFinite(id) && parts.length === 3 && method === "GET") {
    const row = await first(env.DB, "SELECT s.*, c.name AS camera_name FROM person_sessions s LEFT JOIN cameras c ON c.id=s.camera_id WHERE s.id=?", id);
    if (!row) return fail("Person session not found", 404);
    if (row.camera_id && !ids.includes(Number(row.camera_id))) return fail("Camera access is read-only", 403);
    return json(personSessionView(row));
  }
  if (Number.isFinite(id) && parts.length === 4 && parts[3] === "close" && method === "POST") {
    const row = await first(env.DB, "SELECT * FROM person_sessions WHERE id=?", id);
    if (!row) return fail("Person session not found", 404);
    if (row.camera_id && !ids.includes(Number(row.camera_id))) return fail("Camera access is read-only", 403);
    const now = new Date().toISOString();
    const lastMs = Date.parse(row.last_seen_at);
    const entryMs = Date.parse(row.entry_at);
    const duration = Number.isFinite(lastMs) && Number.isFinite(entryMs) ? Math.max(0, (lastMs - entryMs) / 1000) : null;
    await run(env.DB, "UPDATE person_sessions SET status='completed', exit_at=?, duration_seconds=?, updated_at=? WHERE id=?", row.last_seen_at, duration, now, id);
    const updated = await first(env.DB, "SELECT s.*, c.name AS camera_name FROM person_sessions s LEFT JOIN cameras c ON c.id=s.camera_id WHERE s.id=?", id);
    return json(personSessionView(updated));
  }
  return fail("Not found", 404);
};

const alertsRoute = async (request: Request, env: Env, parts: string[], method: string, url: URL, user: any): Promise<Response> => {
  const ids = await accessibleCameraIds(env.DB, user);
  if (parts.length === 2 && method === "GET") {
    const params: any[] = [];
    let sql = "SELECT a.*, c.name AS camera_name FROM alerts a LEFT JOIN cameras c ON c.id=a.camera_id WHERE 1=1";
    sql += cameraFilterSql(ids, params, "a.camera_id", isAdmin(user));
    const status = String(url.searchParams.get("status") ?? "").trim().toLowerCase();
    if (["new", "acknowledged", "resolved"].includes(status)) { sql += " AND a.status=?"; params.push(status); }
    const severity = String(url.searchParams.get("severity") ?? "").trim().toLowerCase();
    if (["info", "warning", "critical"].includes(severity)) { sql += " AND a.severity=?"; params.push(severity); }
    sql += " ORDER BY a.created_at DESC LIMIT 500";
    return json((await all(env.DB, sql, ...params)).map(alertView));
  }
  const id = Number(parts[2]);
  if (!Number.isFinite(id)) return fail("Alert not found", 404);
  const alert = await first(env.DB, "SELECT * FROM alerts WHERE id=?", id);
  if (!alert) return fail("Alert not found", 404);
  if (alert.camera_id) {
    const access = await cameraFor(env.DB, user, alert.camera_id, "manage");
    if (access instanceof Response) return access;
  } else if (!isAdmin(user)) {
    return fail("Camera access is read-only", 403);
  }
  if ((method === "PATCH" || method === "PUT") && parts.length === 3) {
    const data = await bodyOf(request);
    const status = String(data.status ?? (method === "PATCH" ? "acknowledged" : "")).trim().toLowerCase();
    if (!["new", "acknowledged", "resolved"].includes(status)) return fail("Status must be new, acknowledged, or resolved", 422);
    await run(env.DB, "UPDATE alerts SET status=?,updated_at=? WHERE id=?", status, stamp(), id);
    await audit(request, env, user, `alert.${status}`, String(id), alert.camera_id ?? null);
    return json(alertView(await first(env.DB, "SELECT * FROM alerts WHERE id=?", id)));
  }
  return fail("Not found", 404);
};

const sharingHistoryRoute = async (env: Env, user: any): Promise<Response> => {
  const rows = await all(env.DB, "SELECT * FROM audit_logs WHERE action LIKE 'sharing.%' ORDER BY created_at DESC LIMIT 200");
  const ids = new Set(await accessibleCameraIds(env.DB, user));
  const visible = rows.filter((row: any) => isAdmin(user) || ids.has(Number(row.camera_id)) || String(row.username ?? "").toLowerCase() === String(user.username ?? "").toLowerCase());
  return json(visible.map(monitoringActivityView));
};

const testIntegration = async (request: Request, env: Env, parts: string[], user: any): Promise<Response> => {
  const data = await bodyOf(request);
  let endpoint = String(data.endpoint ?? "").trim();
  let secret = String(data.secret ?? "");
  let authMethod = String(data.auth_method ?? "none");
  if (!endpoint) {
    const id = Number(parts[2]);
    const integration = Number.isFinite(id) ? await first(env.DB, "SELECT * FROM integrations WHERE id=?", id) : null;
    if (!integration) return fail("Integration not found", 404);
    endpoint = String(integration.endpoint ?? "").trim();
    authMethod = String(integration.auth_method ?? "none");
    secret = await decryptSecret(integration.secret_enc, env.ENCRYPTION_KEY || env.SECRET_KEY);
  }
  if (!/^https?:\/\/\S+$/i.test(endpoint)) return fail("Enter a valid http or https endpoint", 422);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authMethod === "bearer" && secret) headers.Authorization = `Bearer ${secret}`;
  else if (authMethod === "basic" && secret) headers.Authorization = `Basic ${secret}`;
  else if (authMethod === "api_key" && secret) headers["X-API-Key"] = secret;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({ type: "test", event: "test", message: "LocalVision integration test" }),
      signal: controller.signal
    });
    const text = await response.text();
    await audit(request, env, user, "integration.tested", endpoint.slice(0, 200));
    return json({ ok: response.ok, status: response.status, response: text.slice(0, 500) }, response.ok ? 200 : 502);
  } catch (error: any) {
    return fail(error?.message || "Integration endpoint is unreachable", 502);
  } finally {
    clearTimeout(timer);
  }
};

const probeTotal = (servers: any[]): number => servers.reduce((sum, server) => sum + (server.probe?.usage?.total_bytes ?? 0), 0);

const route = async (request: Request, env: Env): Promise<Response> => {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();
  const parts = path.split("/").filter(Boolean);

  if (path === "/api/ws" && request.headers.get("upgrade")?.toLowerCase() === "websocket") {
    const pair = new WebSocketPair();
    pair[1].accept();
    return new Response(null, { status: 101, webSocket: pair[0] } as any);
  }
  if (path === "/api/health" || path === "/api/ready" || path === "/health" || path === "/ready") {
    return json({ status: "ok", platform: "cloudflare" });
  }
  if (path === "/api/version") return json({ version: "0.1.0" });
  if (path.startsWith("/api/bridge/")) {
    if (!env.MEDIA_BRIDGE_TOKEN || request.headers.get("x-bridge-token") !== env.MEDIA_BRIDGE_TOKEN) return fail("Invalid bridge token", 401);
    if (path === "/api/bridge/config" && method === "GET") return bridgeConfig(env);
    if (path === "/api/bridge/recordings" && method === "POST") return bridgeRecordingUpsert(request, env);
    if (path === "/api/bridge/events" && method === "POST") return bridgeEventIngest(request, env);
    return fail("Not found", 404);
  }
  if (path === "/api/auth/login" && method === "POST") return login(request, env);
  if (path === "/api/auth/guest" && method === "POST") return guestLogin(request, env);
  if (method === "OPTIONS") return empty();

  const user = await currentUser(request, env);
  if (!user) return fail("Authentication required", 401);

  if (path === "/api/auth/me" && method === "GET") return json(userView(user));
  if (path === "/api/auth/logout" && method === "POST") {
    const token = parseCookies(request).localvision_session;
    if (token) {
      await audit(request, env, user, "logout", "session");
      await closeSessionHistory(env, token, "logout");
      await run(env.DB, "DELETE FROM sessions WHERE id=?", token);
    }
    return empty();
  }
  if (path === "/api/auth/password" && method === "POST") {
    const data = await bodyOf(request);
    if (!(await verifyPassword(String(data.current_password ?? ""), user.password_hash))) {
      return fail("Current password is incorrect");
    }
    const next = String(data.new_password ?? "");
    if (next.length < 8) return fail("New password must be at least 8 characters");
    const token = parseCookies(request).localvision_session;
    const revoked = await all(env.DB, "SELECT id FROM sessions WHERE user_id=? AND id<>?", user.id, token);
    await run(env.DB, "UPDATE users SET password_hash=? WHERE id=?", await hashPassword(next), user.id);
    for (const session of revoked) await closeSessionHistory(env, String(session.id), "password_changed");
    await run(env.DB, "DELETE FROM sessions WHERE user_id=? AND id<>?", user.id, token);
    await audit(request, env, user, "password.changed", "account");
    return empty();
  }

  if (parts[1] === "admin" && parts[2] === "monitoring") return monitoringRoute(request, env, parts, method, url, user);
  if (parts[1] === "cameras") return camerasRoute(request, env, parts, method, user);
  if (parts[1] === "users") return usersRoute(request, env, parts, method, user);
  if (parts[1] === "storage") {
    if (user.role !== "admin") return fail("Storage access restricted to administrators", 403);
    if (parts[2] === "servers") return storageServersRoute(request, env, parts, method, user);
    if ((path === "/api/storage/overview" || path === "/api/storage") && method === "GET") return storageOverview(env);
  }

  if (parts[1] === "integrations") {
    if (parts.length === 2 && method === "GET") {
      return json((await all(env.DB, "SELECT * FROM integrations ORDER BY id")).map(integrationView));
    }
    if (parts.length === 2 && method === "POST") {
      const data = await bodyOf(request);
      await run(
        env.DB,
        "INSERT INTO integrations (name,kind,endpoint,auth_method,secret_enc,enabled,created_at) VALUES (?,?,?,?,?,?,?)",
        String(data.name ?? ""),
        String(data.kind ?? "webhook"),
        String(data.endpoint ?? ""),
        String(data.auth_method ?? "none"),
        await encryptSecret(data.secret || null, env.ENCRYPTION_KEY || env.SECRET_KEY),
        data.enabled === false ? 0 : 1,
        stamp()
      );
      return json(integrationView(await first(env.DB, "SELECT * FROM integrations ORDER BY id DESC LIMIT 1")), 201);
    }
    const id = Number(parts[2]);
    if (parts[3] === "test" && method === "POST") {
      return testIntegration(request, env, parts, user);
    }
    if (parts.length === 3 && method === "DELETE") {
      await run(env.DB, "DELETE FROM integrations WHERE id=?", id);
      return empty();
    }
  }

  if (parts[1] === "recordings") return recordingsRoute(request, env, parts, method, url, user);

  if (path === "/api/events" || path === "/api/detections") {
    return json(await eventsRoute(env, url, user, path === "/api/detections"));
  }
  if (parts[1] === "person-sessions") return personSessionsRoute(request, env, parts, method, url, user);

  if (parts[1] === "alerts") return alertsRoute(request, env, parts, method, url, user);
  if (path === "/api/sharing/history" && method === "GET") return sharingHistoryRoute(env, user);
  if (path === "/api/audit-logs" && method === "GET") {
    if (!isAdmin(user)) return fail("Administrator access required", 403);
    return json(await all(env.DB, "SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 200"));
  }
  if (path === "/api/ai/settings" && ["GET", "POST", "PUT"].includes(method)) return aiSettingsRoute(request, env, url, method, user);
  if (path === "/api/ai/snapshot" && method === "GET") return aiSnapshotRoute(request, env, url, user);
  if (path === "/api/ai/status" && method === "GET") return json(await aiStatusPayload(env, user));
  if (path === "/api/ai/models" && method === "GET") return aiModelsRoute(env);
  if (path === "/api/ai/ask" && method === "POST") return aiAskRoute(request, env, user);
  if (parts[1] === "surveillance") return surveillanceRoute(request, env, parts, method, user);

  if (path === "/api/settings" && method === "GET") {
    return json({
      version: "0.1.0",
      environment: "cloudflare",
      storage_path: "r2",
      secrets_configured: !!(env.SECRET_KEY || env.ENCRYPTION_KEY || env.ADMIN_PASSWORD)
    });
  }
  if (path === "/api/metrics" && method === "GET") {
    const [bridge, storageRows, ai] = await Promise.all([
      bridgeCameraStatuses(env),
      all(env.DB, "SELECT * FROM storage_servers WHERE enabled=1 ORDER BY id"),
      aiStatusPayload(env, user)
    ]);
    const storageProbes = await Promise.all(storageRows.map(async (row: any) => ({ row, probe: await probeStorage(env, row) })));
    const metrics = systemHealthFrom(bridge, storageProbes);
    metrics.ai = ai.status === "running" ? "ok" : "unavailable";
    metrics.details.ai = ai.error || (ai.status === "running" ? `Local detector running · ${ai.counts.events} event(s)` : "Local detector is not running");
    return json(metrics);
  }
  if (path === "/api/ai" && method === "GET") return json(await aiStatusPayload(env, user));
  if (path === "/api/storage" && method === "GET") return storageOverview(env);
  if (path === "/api/system" && method === "GET") return json({ platform: "cloudflare", version: "0.1.0" });
  if (parts[1] === "media") return fail("Media files require a local storage service.", 501);

  return fail("Not found", 404);
};

export async function handleApi(request: Request, env: Env): Promise<Response> {
  await ensureSeeded(env);
  const response = await route(request, env);
  const origin = request.headers.get("origin");
  if (!origin || response.headers.has("access-control-allow-origin")) return response;
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", origin);
  headers.set("access-control-allow-credentials", "true");
  headers.set("vary", "Origin");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
