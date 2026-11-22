import http from "node:http";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, statSync, existsSync, unlinkSync } from "node:fs";
import path from "node:path";
import { timingSafeEqual } from "node:crypto";
import ffmpegPath from "ffmpeg-static";

try {
  for (const line of readFileSync(new URL("./.env", import.meta.url), "utf8").split(/\r?\n/)) {
    const index = line.indexOf("=");
    if (index > 0 && !process.env[line.slice(0, index)]) process.env[line.slice(0, index)] = line.slice(index + 1).trim();
  }
} catch {}

const port = Number(process.env.BRIDGE_PORT || 8792);
const token = process.env.MEDIA_BRIDGE_TOKEN || "";
const workerUrl = (process.env.WORKER_URL || "https://balasoftware.in").replace(/\/+$/, "");
const configInterval = Math.max(5000, Number(process.env.BRIDGE_CONFIG_INTERVAL_MS || 10000));
const recordingRoot = process.env.STORAGE_ROOT || path.join(process.cwd(), "recordings");
const hlsRoot = path.join(recordingRoot, "hls");
const segmentSeconds = Math.max(30, Number(process.env.RECORDING_SEGMENT_SECONDS || 3600));
const localAiChatUrl = (process.env.LOCAL_AI_CHAT_URL || "http://127.0.0.1:8100").replace(/\/+$/, "");
const localAiModelsUrl = (process.env.LOCAL_AI_MODELS_URL || "http://127.0.0.1:8200").replace(/\/+$/, "");

const cameras = new Map();
const sessions = new Map();
const uploadQueue = new Map();
let storageConfig = null;
let configLoadedAt = 0;
let configError = "";
let uploading = false;
const aiState = {
  running: true,
  settings: [],
  zones: [],
  models: [],
  lastFrameAt: null,
  lastError: null,
  detections: 0
};

const sameToken = (value, expected) => {
  if (!expected) return false;
  const left = Buffer.from(String(value || ""));
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
};

const authorized = (request) => sameToken(request.headers["x-bridge-token"], token);

const sourceUrl = (request) => {
  const value = String(request.headers["x-rtsp-url"] || "");
  return /^rtsps?:\/\/\S+$/i.test(value) ? value : null;
};

const safeName = (value) => String(value || "Camera").replace(/[^A-Za-z0-9_.-]+/g, "_").replace(/^[._]+|[._]+$/g, "") || "Camera";
const redact = (text, source) => String(text || "").split(source).join("[redacted-source]").slice(-1200);
const newDate = () => new Date();
const datePart = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const timePart = (date) => `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:${String(date.getSeconds()).padStart(2, "0")}`;
const cameraFolder = (camera) => `Camera-${Number(camera.id)}`;
const segmentWindow = (started) => {
  const nextHour = new Date(started);
  nextHour.setHours(nextHour.getHours() + 1, 0, 0, 0);
  const untilHour = Math.floor((nextHour.getTime() - started.getTime()) / 1000);
  return Math.max(30, Math.min(segmentSeconds, untilHour > 30 ? untilHour : segmentSeconds));
};

const getSession = (id, camera) => {
  let session = sessions.get(Number(id));
  if (!session) {
    session = {
      id: Number(id),
      camera: null,
      hlsProcess: null,
      hlsStatus: "stopped",
      hlsError: "",
      hlsRestarts: 0,
      hlsSource: "",
      hlsStarting: false,
      recordDesired: false,
      recordProcess: null,
      recordStatus: "stopped",
      recordError: "",
      recordRestarts: 0,
      recordGeneration: 0,
      lastRecordingAt: null,
      aiDesired: false,
      aiLoopActive: false,
      aiError: null,
      lastAiFrameAt: null,
      aiDetections: 0
    };
    sessions.set(Number(id), session);
  }
  if (camera) session.camera = camera;
  return session;
};

const startHls = (session) => {
  const camera = session.camera;
  if (!camera?.enabled || !camera.source) return;
  if (session.hlsProcess && session.hlsProcess.exitCode === null && session.hlsSource !== camera.source) stopHls(session);
  if (session.hlsStarting && session.hlsSource !== camera.source) {
    session.hlsProcess?.kill("SIGTERM");
    session.hlsProcess = null;
    session.hlsStarting = false;
  }
  if (session.hlsProcess && session.hlsProcess.exitCode === null) return;
  if (session.hlsStarting) return;
  session.hlsStarting = true;
  session.hlsSource = camera.source;
  session.hlsError = "";
  session.hlsStatus = "starting";
  const dir = path.join(hlsRoot, String(session.id));
  mkdirSync(dir, { recursive: true });
  const playlist = path.join(dir, "index.m3u8");
  const args = [
    "-hide_banner", "-loglevel", "error", "-rtsp_transport", "tcp",
    "-fflags", "nobuffer", "-flags", "low_delay", "-analyzeduration", "1000000", "-probesize", "1000000",
    "-i", camera.source, "-an",
    "-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency", "-pix_fmt", "yuv420p",
    "-g", "20", "-keyint_min", "20", "-sc_threshold", "0",
    "-f", "hls", "-hls_time", "2", "-hls_list_size", "6",
    "-hls_flags", "delete_segments+append_list+independent_segments",
    "-hls_segment_filename", path.join(dir, "seg-%06d.ts"), "-y", playlist
  ];
  const child = spawn(ffmpegPath, args, { stdio: ["ignore", "ignore", "pipe"] });
  session.hlsProcess = child;
  child.stderr.on("data", (chunk) => { session.hlsError = redact(`${session.hlsError}${chunk}`, camera.source); });
  child.once("spawn", () => {
    session.hlsStarting = false;
    session.hlsStatus = "online";
  });
  child.once("error", (error) => {
    session.hlsStarting = false;
    session.hlsError = redact(error.message, camera.source);
  });
  child.once("close", () => {
    session.hlsStarting = false;
    if (session.hlsProcess !== child) return;
    session.hlsProcess = null;
    if (!session.camera?.enabled || session.hlsSource !== camera.source) return;
    session.hlsStatus = "reconnecting";
    session.hlsRestarts += 1;
    setTimeout(() => startHls(session), Math.min(10000, 1000 * session.hlsRestarts));
  });
};

const stopHls = (session) => {
  session.hlsSource = "";
  session.hlsStarting = false;
  session.hlsStatus = "stopped";
  if (session.hlsProcess && session.hlsProcess.exitCode === null) session.hlsProcess.kill("SIGTERM");
  session.hlsProcess = null;
};

const applyStorageAuth = (headers, config) => {
  const secret = String(config.secret || "");
  if (!secret) return;
  if (config.auth_method === "bearer" || config.auth_method === "api_key") headers.set("Authorization", `Bearer ${secret}`);
  else if (config.auth_method === "basic") headers.set("Authorization", `Basic ${secret}`);
};

const reportRecording = async (metadata) => {
  const response = await fetch(`${workerUrl}/api/bridge/recordings`, {
    method: "POST",
    headers: { "X-Bridge-Token": token, "Content-Type": "application/json" },
    body: JSON.stringify(metadata),
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) throw new Error(`Recording index failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
  const data = await response.json().catch(() => ({}));
  return data.id ? Number(data.id) : null;
};

const uploadRecording = async (item) => {
  if (!storageConfig?.endpoint) throw new Error("Storage API is not configured");
  const bytes = await readFileSync(item.file);
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: "video/mp4" }), item.metadata.filename);
  form.append("camera_id", String(item.metadata.camera_id));
  form.append("camera", item.metadata.camera);
  form.append("date", item.metadata.date);
  form.append("time", item.metadata.time);
  form.append("duration_seconds", String(item.metadata.duration_seconds));
  const headers = new Headers();
  applyStorageAuth(headers, storageConfig);
  const target = `${storageConfig.endpoint.replace(/\/+$/, "")}/api/storage/upload`;
  const original = new URL(target);
  let current = target;
  let response;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    response = await fetch(current, { method: "POST", headers, body: form, redirect: "manual", signal: AbortSignal.timeout(120000) });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get("location");
    if (!location) throw new Error(`Storage upload redirected without a target (${response.status})`);
    const redirected = new URL(location, current);
    if (redirected.origin !== original.origin) throw new Error("Storage upload redirect must stay on the same origin");
    current = redirected.toString();
  }
  if (response.ok || response.status === 409) {
    const saved = await response.json().catch(() => ({}));
    await reportRecording({
      ...item.metadata,
      storage_server_id: storageConfig.id,
      storage_recording_id: saved.id || item.metadata.storage_recording_id,
      status: "ready"
    });
    unlinkSync(item.file);
    return;
  }
  throw new Error(`Storage upload failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
};

const drainUploadQueue = async () => {
  if (uploading || !uploadQueue.size) return;
  uploading = true;
  try {
    for (const [file, item] of uploadQueue) {
      try {
        await uploadRecording(item);
        uploadQueue.delete(file);
      } catch (error) {
        item.error = error instanceof Error ? error.message : "Upload failed";
      }
    }
  } finally {
    uploading = false;
  }
};

const queueUpload = async (session, camera, file, metadata) => {
  if (!uploadQueue.has(file)) uploadQueue.set(file, { file, metadata, sessionId: session.id, cameraId: camera.id });
  await drainUploadQueue();
};

const aiDefaults = {
  detection_confidence: 0.55,
  motion_threshold: 12,
  frame_interval_ms: 10000,
  max_objects: 5,
  surveillance_enabled: true,
  alert_severity: "warning",
  notify_webhooks: true,
  voice_enabled: true,
  person_only: false
};

const parseSetting = (raw) => {
  try { return JSON.parse(String(raw)); } catch { return String(raw); }
};

const settingsForCamera = (cameraId) => {
  const settings = { ...aiDefaults };
  for (const item of aiState.settings) {
    if (item.enabled === false) continue;
    if (item.camera_id !== null && Number(item.camera_id) !== Number(cameraId)) continue;
    settings[item.key] = parseSetting(item.value);
  }
  return settings;
};

const zonesForCamera = (cameraId) => aiState.zones.filter((zone) => Number(zone.camera_id) === Number(cameraId));

const captureFrame = (source) => new Promise((resolve, reject) => {
  const child = spawn(ffmpegPath, ffmpegArgs(source, true), { stdio: ["ignore", "pipe", "pipe"] });
  const chunks = [];
  let stderr = "";
  let done = false;
  const timer = setTimeout(() => child.kill("SIGKILL"), 15000);
  child.stdout.on("data", (chunk) => chunks.push(chunk));
  child.stderr.on("data", (chunk) => { stderr = redact(`${stderr}${chunk}`, source); });
  child.once("error", (error) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    reject(new Error(redact(error.message, source)));
  });
  child.once("close", () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    const image = Buffer.concat(chunks);
    if (image.includes(Buffer.from([0xff, 0xd8]))) resolve(image);
    else reject(new Error(stderr || "No frame was received from the camera"));
  });
});

const reportAiEvent = async (payload) => {
  const response = await fetch(`${workerUrl}/api/bridge/events`, {
    method: "POST",
    headers: { "X-Bridge-Token": token, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) throw new Error(`Event index failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
  return await response.json().catch(() => ({}));
};

const analyzeFrame = async (session, camera) => {
  if (!storageConfig?.endpoint) throw new Error("Storage API is not configured");
  const settings = settingsForCamera(camera.id);
  const timestamp = new Date().toISOString();
  const frame = await captureFrame(camera.source);
  const form = new FormData();
  form.append("frame", new Blob([frame], { type: "image/jpeg" }), "frame.jpg");
  form.append("camera_id", String(camera.id));
  form.append("camera", safeName(camera.name));
  form.append("timestamp", timestamp);
  form.append("zones", JSON.stringify(zonesForCamera(camera.id)));
  form.append("settings", JSON.stringify(settings));
  const headers = new Headers();
  applyStorageAuth(headers, storageConfig);
  const target = `${storageConfig.endpoint.replace(/\/+$/, "")}/api/storage/ai/detect`;
  const response = await fetch(target, { method: "POST", headers, body: form, signal: AbortSignal.timeout(45000) });
  const text = await response.text();
  if (!response.ok) throw new Error(`AI detection failed (${response.status}): ${text.slice(0, 300)}`);
  let payload;
  try { payload = text ? JSON.parse(text) : {}; } catch { throw new Error("AI detection returned invalid JSON"); }
  const detections = Array.isArray(payload.detections) ? payload.detections : [];
  for (const detection of detections) {
    const confidence = Math.min(1, Math.max(0, Number(detection.confidence ?? detection.score ?? 0)));
    const objectName = String(detection.label ?? detection.class ?? detection.object_name ?? "object");
    await reportAiEvent({
      camera_id: camera.id,
      kind: "detection",
      object_name: objectName,
      confidence,
      occurred_at: String(detection.timestamp ?? timestamp),
      snapshot_path: String(detection.snapshot_path ?? payload.snapshot_path ?? ""),
      bounding_box: detection.bounding_box ?? detection.box ?? null,
      track_id: detection.track_id ?? null,
      severity: confidence >= 0.85 ? "critical" : String(settings.alert_severity ?? "warning"),
      description: String(detection.description ?? `${objectName} detected at ${confidence.toFixed(2)} confidence`),
      alert: detection.alert !== false
    });
    session.aiDetections += 1;
    aiState.detections += 1;
  }
  session.lastAiFrameAt = new Date().toISOString();
  aiState.lastFrameAt = session.lastAiFrameAt;
};

const aiLoop = async (session) => {
  if (session.aiLoopActive) return;
  session.aiLoopActive = true;
  while (aiState.running && session.aiDesired && session.camera?.source && session.camera?.enabled) {
    const settings = settingsForCamera(session.id);
    if (settings.surveillance_enabled === false || session.camera.ai_enabled === false) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      continue;
    }
    try {
      await analyzeFrame(session, session.camera);
      session.aiError = null;
      aiState.lastError = null;
    } catch (error) {
      session.aiError = error instanceof Error ? error.message : "AI analysis failed";
      aiState.lastError = session.aiError;
    }
    const interval = Math.max(2000, Number(settings.frame_interval_ms) || 10000);
    await new Promise(resolve => setTimeout(resolve, interval));
  }
  session.aiLoopActive = false;
};

const startAi = (session) => {
  session.aiDesired = true;
  if (!session.aiLoopActive) void aiLoop(session);
};

const stopAi = (session) => {
  session.aiDesired = false;
};

const refreshAiModels = async () => {
  const models = [];
  try {
    const response = await fetch(`${localAiModelsUrl}/v1/models`, { signal: AbortSignal.timeout(5000) });
    if (response.ok) {
      const payload = await response.json().catch(() => ({}));
      for (const item of payload.data ?? []) models.push({ id: item.id, kind: "chat", endpoint: localAiModelsUrl });
    }
  } catch {}
  aiState.models = models;
};

const recordChunk = async (session, source, file, duration) => {
  const args = [
    "-hide_banner", "-loglevel", "error", "-rtsp_transport", "tcp",
    "-fflags", "nobuffer", "-flags", "low_delay", "-analyzeduration", "1000000", "-probesize", "1000000",
    "-i", source, "-t", String(duration), "-an",
    "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-movflags", "+frag_keyframe+empty_moov+default_base_moof", "-y", file
  ];
  const child = spawn(ffmpegPath, args, { stdio: ["pipe", "ignore", "pipe"] });
  session.recordProcess = child;
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr = redact(`${stderr}${chunk}`, source); });
  const started = Date.now();
  return await new Promise((resolve) => {
    child.once("error", (error) => resolve({ code: -1, stderr: redact(error.message, source), started }));
    child.once("close", (code) => resolve({ code, stderr, started }));
  });
};

const recordLoop = async (session, generation) => {
  while (session.recordDesired && session.recordGeneration === generation && session.camera?.source) {
    const camera = session.camera;
    const started = newDate();
    const date = datePart(started);
    const time = timePart(started);
    const folder = cameraFolder(camera);
    const duration = segmentWindow(started);
    const filename = `${folder}_${date}_${time.replace(/:/g, "-")}.mp4`;
    const dir = path.join(recordingRoot, "recordings", folder, date);
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, filename);
    const metadata = {
      camera_id: camera.id,
      name: safeName(camera.name),
      camera: folder,
      date,
      time,
      filename,
      duration_seconds: null,
      size_bytes: 0,
      status: "recording",
      started_at: started.toISOString(),
      ended_at: null
    };
    try {
      await reportRecording(metadata).catch(() => null);
      const result = await recordChunk(session, camera.source, file, duration);
      if (session.recordProcess) session.recordProcess = null;
      if (session.recordGeneration !== generation) {
        const size = existsSync(file) ? statSync(file).size : 0;
        if (size > 0) {
          metadata.duration_seconds = duration;
          metadata.size_bytes = size;
          metadata.status = "ready";
          metadata.ended_at = new Date(started.getTime() + duration * 1000).toISOString();
          session.lastRecordingAt = metadata.ended_at;
          await reportRecording(metadata).catch(() => null);
          await queueUpload(session, camera, file, metadata);
        }
        return;
      }
      const size = existsSync(file) ? statSync(file).size : 0;
      if (result.code === 0 && size > 0) {
        metadata.duration_seconds = duration;
        metadata.size_bytes = size;
        metadata.ended_at = new Date(started.getTime() + duration * 1000).toISOString();
        session.lastRecordingAt = metadata.ended_at;
        session.recordStatus = "recording";
        session.recordError = "";
        await queueUpload(session, camera, file, metadata);
      } else {
        metadata.duration_seconds = 0;
        metadata.size_bytes = size;
        metadata.status = "error";
        metadata.ended_at = new Date().toISOString();
        await reportRecording(metadata).catch(() => null);
        session.recordStatus = "reconnecting";
        session.recordError = result.stderr || `Recording failed (${result.code})`;
        session.recordRestarts += 1;
        if (existsSync(file)) unlinkSync(file);
      }
    } catch (error) {
      session.recordStatus = "error";
      session.recordError = error instanceof Error ? error.message : "Recording failed";
    }
    if (session.recordDesired && session.recordGeneration === generation) await new Promise(resolve => setTimeout(resolve, 2000));
  }
};

const startRecording = (session) => {
  if (!session.camera?.source) throw new Error("No RTSP source is configured for this camera");
  if (session.recordDesired && session.recordStatus !== "stopped") return;
  session.recordGeneration += 1;
  session.recordDesired = true;
  session.recordStatus = "starting";
  session.recordError = "";
  void recordLoop(session, session.recordGeneration);
};

const stopRecording = (session) => {
  session.recordGeneration += 1;
  session.recordDesired = false;
  session.recordStatus = "stopped";
  if (session.recordProcess && session.recordProcess.exitCode === null) {
    session.recordProcess.stdin?.write("q\n");
    setTimeout(() => session.recordProcess?.kill("SIGTERM"), 2000).unref();
  }
  session.recordProcess = null;
};

const applyConfig = (config) => {
  storageConfig = config.storage || null;
  aiState.settings = Array.isArray(config.ai_settings) ? config.ai_settings : [];
  aiState.zones = Array.isArray(config.zones) ? config.zones : [];
  const nextIds = new Set();
  for (const camera of config.cameras || []) {
    nextIds.add(Number(camera.id));
    const session = getSession(camera.id, camera);
    if (camera.enabled) startHls(session);
    else stopHls(session);
    if (camera.recording_enabled) startRecording(session);
    else stopRecording(session);
    if (camera.enabled && camera.ai_enabled !== false) startAi(session);
    else stopAi(session);
  }
  for (const [id, session] of sessions) {
    if (nextIds.has(id)) continue;
    stopHls(session);
    stopRecording(session);
    stopAi(session);
  }
};

const loadConfig = async () => {
  const response = await fetch(`${workerUrl}/api/bridge/config`, {
    headers: { "X-Bridge-Token": token },
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error(`Config request failed (${response.status})`);
  const config = await response.json();
  applyConfig(config);
  configLoadedAt = Date.now();
  configError = "";
};

const ffmpegArgs = (url, snapshot) => [
  "-hide_banner", "-loglevel", "error", "-rtsp_transport", "tcp",
  "-fflags", "nobuffer", "-flags", "low_delay", "-analyzeduration", "1000000", "-probesize", "1000000",
  "-i", url, "-an",
  ...(snapshot ? ["-frames:v", "1"] : ["-vf", "fps=10,scale=640:-2"]),
  "-c:v", "mjpeg", "-q:v", "5", "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1"
];

const writeFrame = (response, frame) => {
  response.write(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`);
  response.write(frame);
  response.write("\r\n");
};

const stream = (request, response, url) => {
  const child = spawn(ffmpegPath, ffmpegArgs(url, false), { stdio: ["ignore", "pipe", "pipe"] });
  let buffer = Buffer.alloc(0);
  let closed = false;
  response.writeHead(200, {
    "content-type": "multipart/x-mixed-replace; boundary=frame",
    "cache-control": "no-store",
    "x-accel-buffering": "no"
  });
  child.stdout.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      const start = buffer.indexOf(Buffer.from([0xff, 0xd8]));
      if (start < 0) {
        buffer = buffer.subarray(Math.max(0, buffer.length - 3));
        break;
      }
      const end = buffer.indexOf(Buffer.from([0xff, 0xd9]), start + 2);
      if (end < 0) break;
      const frame = buffer.subarray(start, end + 2);
      buffer = buffer.subarray(end + 2);
      if (!writeFrame(response, frame)) {
        child.stdout.pause();
        response.once("drain", () => child.stdout.resume());
      }
    }
  });
  child.stderr.on("data", () => undefined);
  child.on("error", () => child.kill());
  child.on("close", () => { if (!closed) { closed = true; response.end(); } });
  response.on("close", () => { if (!closed) { closed = true; child.kill(); } });
};

const snapshot = (response, url) => {
  const child = spawn(ffmpegPath, ffmpegArgs(url, true), { stdio: ["ignore", "pipe", "pipe"] });
  const chunks = [];
  let stderr = "";
  const timer = setTimeout(() => child.kill(), 12000);
  child.stdout.on("data", (chunk) => chunks.push(chunk));
  child.stderr.on("data", (chunk) => { stderr = redact(`${stderr}${chunk}`, url); });
  child.on("error", (error) => { stderr = redact(error.message, url); });
  child.on("close", () => {
    clearTimeout(timer);
    const image = Buffer.concat(chunks);
    if (image.includes(Buffer.from([0xff, 0xd8]))) {
      response.writeHead(200, { "content-type": "image/jpeg", "cache-control": "no-store" });
      response.end(image);
      return;
    }
    response.writeHead(502, { "content-type": "application/json" });
    response.end(JSON.stringify({ detail: `Camera snapshot failed: ${stderr || "no frame received"}` }));
  });
};

const sendJson = (response, status, data) => {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(JSON.stringify(data));
};

const readJson = async (request) => {
  const text = await request.text();
  if (!text) return {};
  try { return JSON.parse(text); } catch { throw new Error("Invalid JSON body"); }
};

const aiStatus = () => {
  const cameras = {};
  for (const session of sessions.values()) {
    cameras[String(session.id)] = {
      enabled: !!session.camera?.enabled,
      ai_enabled: session.camera?.ai_enabled !== false,
      running: session.aiLoopActive && aiState.running,
      last_frame_at: session.lastAiFrameAt,
      detections: session.aiDetections,
      error: session.aiError
    };
  }
  return {
    running: aiState.running,
    detector: {
      active: "hybrid-cv",
      provider: "local-storage-api",
      model: "opencv-cascade+motion",
      status: aiState.running ? "running" : "stopped",
      local_only: true,
      error: aiState.lastError
    },
    models: aiState.models,
    cameras,
    fps: aiState.lastFrameAt ? Math.round((1 / Math.max(1, Number(settingsForCamera([...sessions.keys()][0] ?? 0).frame_interval_ms || 10000) / 1000)) * 100) / 100 : null,
    last_frame_at: aiState.lastFrameAt,
    detections: aiState.detections,
    error: aiState.lastError
  };
};

const hlsStatus = (session) => {
  const playlist = path.join(hlsRoot, String(session.id), "index.m3u8");
  let lastFrameAt = null;
  try { lastFrameAt = new Date(statSync(playlist).mtimeMs).toISOString(); } catch {}
  const queueErrors = [...uploadQueue.values()].filter(item => item.sessionId === session.id).map(item => item.error).filter(Boolean);
  return {
    camera_id: session.id,
    status: session.hlsStatus === "online" ? (lastFrameAt ? "online" : "starting") : session.hlsStatus,
    message: session.hlsError || configError || null,
    resolution: null,
    fps: null,
    last_frame_at: lastFrameAt,
    restarts: session.hlsRestarts,
    recording: session.recordStatus,
    recording_error: session.recordError || queueErrors[0] || null,
    last_recording_at: session.lastRecordingAt
  };
};

const hlsPlaylist = async (response, session) => {
  const file = path.join(hlsRoot, String(session.id), "index.m3u8");
  let playlist = null;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (existsSync(file) && statSync(file).size > 0) {
      const lines = readFileSync(file, "utf8").split(/\r?\n/).map(line => line.trim()).filter(Boolean);
      if (lines.some(line => line.endsWith(".ts"))) {
        const header = lines.filter(line => line === "#EXTM3U");
        const body = lines.filter(line => line !== "#EXTM3U");
        playlist = Buffer.from([...(header.length ? header : ["#EXTM3U"]), ...body].join("\n") + "\n");
        break;
      }
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!playlist) {
    sendJson(response, 503, { detail: "Live stream is starting or unavailable" });
    return;
  }
  response.writeHead(200, { "content-type": "application/vnd.apple.mpegurl", "cache-control": "no-store" });
  response.end(playlist);
};

const hlsSegment = (response, session, segment) => {
  if (!/^[A-Za-z0-9._-]+$/.test(segment)) {
    sendJson(response, 400, { detail: "Invalid HLS segment" });
    return;
  }
  const file = path.join(hlsRoot, String(session.id), path.basename(segment));
  if (!existsSync(file)) {
    sendJson(response, 404, { detail: "HLS segment is no longer available" });
    return;
  }
  response.writeHead(200, { "content-type": "video/mp2t", "cache-control": "no-store" });
  response.end(readFileSync(file));
};

http.createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  const pathname = url.pathname;

  if (pathname === "/health") {
    sendJson(response, 200, { ok: true, config_loaded_at: configLoadedAt || null, config_error: configError || null, sessions: sessions.size, recording_sessions: [...sessions.values()].filter(item => item.recordDesired).length });
    return;
  }
  if (!authorized(request)) {
    sendJson(response, 401, { detail: "Invalid bridge token" });
    return;
  }

  if (pathname === "/status" && request.method === "GET") {
    sendJson(response, 200, {
      ok: true,
      config_loaded_at: configLoadedAt || null,
      config_error: configError || null,
      generated_at: new Date().toISOString(),
      cameras: [...sessions.values()].map(hlsStatus)
    });
    return;
  }

  if (pathname === "/ai/status" && request.method === "GET") {
    sendJson(response, 200, aiStatus());
    return;
  }
  if (pathname === "/ai/models" && request.method === "GET") {
    sendJson(response, 200, { models: aiState.models });
    return;
  }
  if (pathname === "/ai/start" && request.method === "POST") {
    const data = await readJson(request).catch(() => ({}));
    aiState.running = true;
    const cameraId = Number(data.camera_id);
    if (Number.isFinite(cameraId) && cameraId > 0) {
      const session = getSession(cameraId);
      startAi(session);
    } else {
      for (const session of sessions.values()) startAi(session);
    }
    sendJson(response, 200, aiStatus());
    return;
  }
  if (pathname === "/ai/stop" && request.method === "POST") {
    const data = await readJson(request).catch(() => ({}));
    const cameraId = Number(data.camera_id);
    if (Number.isFinite(cameraId) && cameraId > 0) stopAi(getSession(cameraId));
    else aiState.running = false;
    sendJson(response, 200, aiStatus());
    return;
  }
  if (pathname === "/ai/chat" && request.method === "POST") {
    try {
      const data = await readJson(request);
      const message = String(data.message ?? "").trim();
      if (!message) throw new Error("Message is required");
      const context = Array.isArray(data.context) ? data.context : [];
      const prompt = context.length ? `Use only these real LocalVision events and alerts to answer. If the answer is not present, say so.\n\n${context.join("\n")}\n\nQuestion: ${message}` : message;
      const upstream = await fetch(`${localAiChatUrl}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: prompt, history: Array.isArray(data.history) ? data.history : [], max_new_tokens: 512, temperature: 0.2 }),
        signal: AbortSignal.timeout(60000)
      });
      const text = await upstream.text();
      if (!upstream.ok) throw new Error(`Local AI returned HTTP ${upstream.status}: ${text.slice(0, 300)}`);
      let payload;
      try { payload = JSON.parse(text); } catch { payload = { answer: text }; }
      sendJson(response, 200, {
        answer: String(payload.answer ?? payload.response ?? payload.message ?? payload.text ?? ""),
        model: payload.model ?? null
      });
    } catch (error) {
      sendJson(response, 502, { detail: error instanceof Error ? error.message : "Local AI request failed" });
    }
    return;
  }

  const hlsMatch = pathname.match(/^\/hls\/(\d+)\/(.+)$/);
  if (hlsMatch && request.method === "GET") {
    const session = getSession(Number(hlsMatch[1]));
    const resource = hlsMatch[2];
    if (resource === "index.m3u8") void hlsPlaylist(response, session);
    else hlsSegment(response, session, resource);
    return;
  }

  const cameraSnapshotMatch = pathname.match(/^\/camera\/(\d+)\/snapshot$/);
  if (cameraSnapshotMatch && request.method === "GET") {
    const session = getSession(Number(cameraSnapshotMatch[1]));
    if (!session.camera?.source) {
      sendJson(response, 422, { detail: "No RTSP source is configured for this camera" });
      return;
    }
    snapshot(response, session.camera.source);
    return;
  }

  const cameraMatch = pathname.match(/^\/camera\/(\d+)\/(status|record\/start|record\/stop|record\/status)$/);
  if (cameraMatch) {
    const session = getSession(Number(cameraMatch[1]));
    const action = cameraMatch[2];
    if (action === "status" && request.method === "GET") {
      sendJson(response, 200, hlsStatus(session));
      return;
    }
    if (action === "record/start" && request.method === "POST") {
      try {
        startRecording(session);
        sendJson(response, 200, { camera_id: session.id, status: session.recordStatus });
      } catch (error) {
        sendJson(response, 422, { detail: error instanceof Error ? error.message : "Recording could not start" });
      }
      return;
    }
    if (action === "record/stop" && request.method === "POST") {
      stopRecording(session);
      sendJson(response, 200, { camera_id: session.id, status: session.recordStatus });
      return;
    }
    if (action === "record/status" && request.method === "GET") {
      sendJson(response, 200, {
        camera_id: session.id,
        status: session.recordStatus,
        desired: session.recordDesired,
        last_error: session.recordError || null,
        last_recording_at: session.lastRecordingAt,
        segment_seconds: segmentSeconds,
        restarts: session.recordRestarts
      });
      return;
    }
  }

  const source = sourceUrl(request);
  if (!source && (pathname === "/stream" || pathname === "/snapshot")) {
    sendJson(response, 400, { detail: "A valid X-RTSP-URL header is required" });
    return;
  }
  if (request.method === "GET" && pathname === "/stream") {
    stream(request, response, source);
    return;
  }
  if (request.method === "GET" && pathname === "/snapshot") {
    snapshot(response, source);
    return;
  }
  sendJson(response, 404, { detail: "Not found" });
}).listen(port, "0.0.0.0", () => console.log(`LocalVision media bridge listening on ${port}`));

loadConfig().catch((error) => { configError = error instanceof Error ? error.message : "Configuration load failed"; });
setInterval(() => loadConfig().catch((error) => { configError = error instanceof Error ? error.message : "Configuration load failed"; }), configInterval);
setInterval(() => void drainUploadQueue(), 15000);
void refreshAiModels();
setInterval(() => void refreshAiModels(), 60000);
