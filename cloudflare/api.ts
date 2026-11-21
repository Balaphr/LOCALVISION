import { all, first, run, parseJson } from "./db";
import { hashPassword, verifyPassword, randomToken, encryptSecret } from "./crypto";

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

const cameraView = (camera: any) => ({
  id: camera.id,
  name: camera.name,
  location: camera.location,
  manufacturer: camera.manufacturer,
  model: camera.model,
  host: camera.host,
  port: camera.port,
  protocol: camera.protocol,
  rtsp_url: camera.rtsp_url ?? null,
  onvif_url: camera.onvif_url ?? null,
  username: camera.username ?? null,
  main_stream: camera.main_stream ?? null,
  sub_stream: camera.sub_stream ?? null,
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

const alertView = (item: any) => ({
  id: item.id,
  kind: item.kind,
  message: item.message,
  status: item.status,
  created_at: item.created_at
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
      if (existing) return;
      const username = (env.ADMIN_USERNAME || "admin").trim();
      const password = env.ADMIN_PASSWORD;
      if (!password) return;
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
    })().catch((error) => {
      seedPromise = undefined;
      throw error;
    });
  }
  return seedPromise;
};

const audit = async (request: Request, env: Env, user: any, action: string, target: string) => {
  try {
    const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "";
    await run(
      env.DB,
      "INSERT INTO audit_logs (user_id,username,action,target,ip,created_at) VALUES (?,?,?,?,?,?)",
      user?.id ?? null,
      user?.username ?? null,
      action,
      target,
      ip,
      stamp()
    );
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
    await run(env.DB, "DELETE FROM sessions WHERE id=?", token);
    return null;
  }
  const user = await first(env.DB, "SELECT * FROM users WHERE id=?", session.user_id);
  if (!user || !user.is_active) return null;
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
  await run(
    env.DB,
    "INSERT INTO sessions (id,user_id,expires_at,created_at) VALUES (?,?,?,?)",
    token,
    user.id,
    new Date(Date.now() + hours * 3600000).toISOString(),
    stamp()
  );
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
  await run(
    env.DB,
    "INSERT INTO sessions (id,user_id,expires_at,created_at) VALUES (?,?,?,?)",
    token,
    user.id,
    new Date(Date.now() + 3600000).toISOString(),
    stamp()
  );
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
        "INSERT INTO cameras (name,location,manufacturer,model,host,port,protocol,rtsp_url,onvif_url,username,password_enc,main_stream,sub_stream,enabled,recording_enabled,ai_enabled,import_endpoint,external_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
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

const camerasRoute = async (request: Request, env: Env, parts: string[], method: string, user: any): Promise<Response> => {
  const db = env.DB;
  const id = parts[2] ? Number(parts[2]) : NaN;
  const sub = parts[3];

  if (parts.length === 2) {
    if (method === "GET") return json((await all(db, "SELECT * FROM cameras ORDER BY id")).map(cameraView));
    if (method === "POST") {
      const data = await bodyOf(request);
      if (!String(data.name ?? "").trim() || !String(data.host ?? "").trim()) return fail("Name and host are required");
      const secret = env.ENCRYPTION_KEY || env.SECRET_KEY;
      await run(
        db,
        "INSERT INTO cameras (name,location,manufacturer,model,host,port,protocol,rtsp_url,onvif_url,username,password_enc,main_stream,sub_stream,enabled,recording_enabled,ai_enabled,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        String(data.name).trim(),
        String(data.location ?? ""),
        String(data.manufacturer ?? "Generic"),
        String(data.model ?? ""),
        String(data.host).trim(),
        Number(data.port ?? 554),
        String(data.protocol ?? "RTSP"),
        data.rtsp_url || null,
        data.onvif_url || null,
        data.username || null,
        await encryptSecret(data.password || null, secret),
        data.main_stream || null,
        data.sub_stream || null,
        data.enabled === false ? 0 : 1,
        data.recording_enabled === false ? 0 : 1,
        data.ai_enabled === false ? 0 : 1,
        stamp(),
        stamp()
      );
      const created = await first(db, "SELECT * FROM cameras ORDER BY id DESC LIMIT 1");
      return json(cameraView(created), 201);
    }
  }

  if (parts[2] === "discover" && method === "POST") return json([]);
  if (parts[2] === "import" && method === "POST") return importCamerasFromApi(request, env, user);
  if (parts[2] === "test" && method === "POST") {
    return json({ status: "unreachable", message: "Live camera probing is not available in the Cloudflare-only deployment." });
  }
  if (parts[2] === "onvif" && parts[3] === "inspect" && method === "POST") {
    return fail("ONVIF inspection requires a local network service and is unavailable in the Cloudflare-only deployment.", 501);
  }
  if (!Number.isFinite(id)) return fail("Camera not found", 404);
  const camera = await first(db, "SELECT * FROM cameras WHERE id=?", id);
  if (!camera) return fail("Camera not found", 404);

  if (parts.length === 3) {
    if (method === "GET") return json(cameraView(camera));
    if (method === "PUT") {
      const data = await bodyOf(request);
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
    return json({ camera_id: id, status: "unreachable", message: "Live camera probing is not available in the Cloudflare-only deployment." });
  }
  if (sub === "status") {
    return json({ camera_id: id, status: "unknown", protocol: camera.protocol, resolution: null, fps: null, message: "Live camera status requires a local media service." });
  }
  if (sub === "snapshot") {
    return json({ camera_id: id, status: "unavailable", message: "Snapshots require a local media service." });
  }
  if (sub === "preview.jpg" || sub === "stream.mjpeg" || sub === "live") {
    return fail("Live media is unavailable in the Cloudflare-only deployment.", 501);
  }

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
      const permission = String(data.permission ?? "viewer");
      await run(
        db,
        "INSERT INTO shares (camera_id,username,role,permission,created_at) VALUES (?,?,?,?,?)",
        id,
        String(data.username ?? ""),
        permission,
        permission,
        stamp()
      );
      const created = await first(db, "SELECT * FROM shares ORDER BY id DESC LIMIT 1");
      return json(shareView(created), 201);
    }
    const shareId = Number(parts[4]);
    if (parts.length === 5 && method === "DELETE") {
      await run(db, "DELETE FROM shares WHERE id=? AND camera_id=?", shareId, id);
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
      return json(userView(await first(db, "SELECT * FROM users WHERE username=?", username)), 201);
    }
  }

  const id = Number(parts[2]);
  const user = await first(db, "SELECT * FROM users WHERE id=?", id);
  if (!user) return fail("User not found", 404);

  if (parts[3] === "sessions" && parts[4] === "revoke" && method === "POST") {
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
    await run(db, "DELETE FROM sessions WHERE user_id=?", id);
    await run(db, "DELETE FROM users WHERE id=?", id);
    return empty();
  }
  return fail("Not found", 404);
};

const storageServersRoute = async (request: Request, env: Env, parts: string[], method: string): Promise<Response> => {
  const db = env.DB;
  if (parts.length === 4) {
    if (method === "GET") return json((await all(db, "SELECT * FROM storage_servers ORDER BY id")).map(storageView));
    if (method === "POST") {
      const data = await bodyOf(request);
      await run(
        db,
        "INSERT INTO storage_servers (name,kind,endpoint,base_path,bucket,region,auth_method,secret_enc,enabled,last_status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        String(data.name ?? ""),
        String(data.kind ?? "local_mount"),
        String(data.endpoint ?? ""),
        data.base_path || null,
        data.bucket || null,
        data.region || null,
        String(data.auth_method ?? "none"),
        await encryptSecret(data.secret || null, env.ENCRYPTION_KEY || env.SECRET_KEY),
        data.enabled === false ? 0 : 1,
        "unknown",
        stamp(),
        stamp()
      );
      return json(storageView(await first(db, "SELECT * FROM storage_servers ORDER BY id DESC LIMIT 1")), 201);
    }
  }
  const id = Number(parts[4]);
  const item = await first(db, "SELECT * FROM storage_servers WHERE id=?", id);
  if (!item) return fail("Storage server not found", 404);
  if (parts[5] === "test" && method === "POST") {
    const checkedAt = stamp();
    await run(db, "UPDATE storage_servers SET last_status=?, last_error=?, last_checked_at=? WHERE id=?", "unreachable", "Storage probing requires a local service.", checkedAt, id);
    return json({ status: "unreachable", message: "Storage probing requires a local service.", usage: null, checked_at: checkedAt });
  }
  if (parts.length === 5 && method === "PATCH") {
    const data = await bodyOf(request);
    const fields: Record<string, any> = {};
    for (const key of ["name", "kind", "endpoint", "base_path", "bucket", "region", "auth_method"]) {
      if (key in data) fields[key] = data[key];
    }
    if ("enabled" in data) fields.enabled = data.enabled ? 1 : 0;
    if (data.secret) fields.secret_enc = await encryptSecret(String(data.secret), env.ENCRYPTION_KEY || env.SECRET_KEY);
    const keys = Object.keys(fields);
    if (keys.length) await run(db, `UPDATE storage_servers SET ${keys.map((key) => `${key}=?`).join(",")}, updated_at=? WHERE id=?`, ...keys.map((key) => fields[key]), stamp(), id);
    return json(storageView(await first(db, "SELECT * FROM storage_servers WHERE id=?", id)));
  }
  if (parts.length === 5 && method === "DELETE") {
    await run(db, "DELETE FROM storage_servers WHERE id=?", id);
    return empty();
  }
  return fail("Not found", 404);
};

const storageOverview = async (env: Env): Promise<Response> => {
  const servers = (await all(env.DB, "SELECT * FROM storage_servers ORDER BY id")).map(storageView);
  const cameraRows = await all(env.DB, "SELECT id,name,protocol,enabled FROM cameras ORDER BY id");
  return json({
    local: zeroUsage("cloudflare-r2"),
    servers,
    cameras: cameraRows.map((camera) => ({
      id: camera.id,
      name: camera.name,
      status: camera.enabled ? "configured" : "disabled",
      protocol: camera.protocol,
      owner: null,
      used_bytes: 0,
      available_bytes: 0,
      percent_used: 0
    })),
    totals: zeroUsage("cloudflare-r2"),
    camera_count: cameraRows.length
  });
};

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
    await run(env.DB, "UPDATE users SET password_hash=? WHERE id=?", await hashPassword(next), user.id);
    await run(env.DB, "DELETE FROM sessions WHERE user_id=? AND id<>?", user.id, token);
    await audit(request, env, user, "password.changed", "account");
    return empty();
  }

  if (parts[1] === "cameras") return camerasRoute(request, env, parts, method, user);
  if (parts[1] === "users") return usersRoute(request, env, parts, method, user);
  if (parts[1] === "storage" && parts[2] === "servers") return storageServersRoute(request, env, parts, method);
  if (path === "/api/storage/overview" && method === "GET") return storageOverview(env);

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
      return json({ ok: false, error: "Outbound integration tests are unavailable in the Cloudflare-only deployment." });
    }
    if (parts.length === 3 && method === "DELETE") {
      await run(env.DB, "DELETE FROM integrations WHERE id=?", id);
      return empty();
    }
  }

  if (path === "/api/recordings" && method === "GET") {
    const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
    const pageSize = Math.max(1, Number(url.searchParams.get("page_size") ?? 25));
    return json({ items: [], page, page_size: pageSize });
  }
  if (parts[1] === "recordings" && parts.length === 3 && method === "DELETE") return empty();
  if (parts[1] === "recordings" && parts[3] === "file") return fail("Recordings require a local media service.", 501);

  if (path === "/api/events" || path === "/api/detections") {
    const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
    const pageSize = Math.max(1, Number(url.searchParams.get("page_size") ?? 25));
    let sql = "SELECT * FROM events WHERE 1=1";
    const params: any[] = [];
    const cameraId = url.searchParams.get("camera_id");
    if (cameraId) {
      sql += " AND camera_id=?";
      params.push(Number(cameraId));
    }
    if (path === "/api/detections") {
      sql += " AND kind='detection'";
    }
    sql += " ORDER BY occurred_at DESC LIMIT ? OFFSET ?";
    params.push(pageSize, (page - 1) * pageSize);
    return json({ items: (await all(env.DB, sql, ...params)).map(eventView), page, page_size: pageSize });
  }

  if (path === "/api/alerts" && method === "GET") {
    return json((await all(env.DB, "SELECT * FROM alerts ORDER BY created_at DESC")).map(alertView));
  }
  if (parts[1] === "alerts" && parts.length === 3 && method === "PATCH") {
    await run(env.DB, "UPDATE alerts SET status='acknowledged' WHERE id=?", Number(parts[2]));
    const alert = await first(env.DB, "SELECT * FROM alerts WHERE id=?", Number(parts[2]));
    return alert ? json(alertView(alert)) : fail("Alert not found", 404);
  }
  if (path === "/api/audit-logs" && method === "GET") {
    return json(await all(env.DB, "SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 200"));
  }

  if (path === "/api/settings" && method === "GET") {
    return json({
      version: "0.1.0",
      environment: "cloudflare",
      storage_path: "r2",
      secrets_configured: !!(env.SECRET_KEY || env.ENCRYPTION_KEY || env.ADMIN_PASSWORD)
    });
  }
  if (path === "/api/metrics" && method === "GET") {
    return json({
      api: "ok",
      media: "unavailable",
      recording: "unavailable",
      ai: "unavailable",
      cpu: null,
      ram: null,
      gpu: null,
      network: "unavailable",
      host: "cloudflare",
      storage: { total_bytes: 0, used_bytes: 0, free_bytes: 0, low: false }
    });
  }
  if (path === "/api/ai" && method === "GET") {
    return json({
      active: "none",
      provider: "cloudflare",
      model: "none",
      status: "unavailable",
      local_only: false,
      error: "AI inference requires a local worker and is unavailable in the Cloudflare-only deployment."
    });
  }
  if (path === "/api/storage" && method === "GET") return storageOverview(env);
  if (path === "/api/system" && method === "GET") return json({ platform: "cloudflare", version: "0.1.0" });
  if (path === "/api/surveillance/status" && method === "GET") {
    return json({
      running: false,
      detector: {
        active: "none",
        provider: "cloudflare",
        model: "none",
        status: "unavailable",
        local_only: false,
        error: "Surveillance workers require a local machine."
      },
      cameras: {}
    });
  }
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
