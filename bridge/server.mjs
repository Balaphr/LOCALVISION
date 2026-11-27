import http from "node:http";
import { spawn, execFile, execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, statSync, existsSync, unlinkSync, createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import path from "node:path";
import os from "node:os";
import { timingSafeEqual } from "node:crypto";
import ffmpegPath from "ffmpeg-static";

const probeEncoder = (candidate) => {
  try {
    execFileSync(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=black:s=64x64:r=5", "-frames:v", "1", "-c:v", candidate, "-f", "null", "-"], { encoding: "utf8", timeout: 10000, stdio: ["ignore", "pipe", "pipe"] });
    return true;
  } catch {
    return false;
  }
};

let videoEncoder = "libx264";
try {
  const encoders = execFileSync(ffmpegPath, ["-hide_banner", "-encoders"], { encoding: "utf8", timeout: 10000 });
  const candidates = [];
  const configured = String(process.env.VIDEO_ENCODER || "").trim();
  if (configured) candidates.push(configured);
  if (/h264_nvenc/.test(encoders)) candidates.push("h264_nvenc");
  if (/h264_qsv/.test(encoders)) candidates.push("h264_qsv");
  if (/h264_vaapi/.test(encoders)) candidates.push("h264_vaapi");
  candidates.push("libx264");
  for (const candidate of [...new Set(candidates)]) {
    if (probeEncoder(candidate)) {
      videoEncoder = candidate;
      break;
    }
  }
} catch {
  videoEncoder = "libx264";
}

try {
  for (const line of readFileSync(new URL("./.env", import.meta.url), "utf8").split(/\r?\n/)) {
    const index = line.indexOf("=");
    if (index > 0 && !process.env[line.slice(0, index)]) process.env[line.slice(0, index)] = line.slice(index + 1).trim();
  }
} catch {}

const port = Number(process.env.BRIDGE_PORT || 8792);
const token = process.env.MEDIA_BRIDGE_TOKEN || "";
const workerUrl = (process.env.WORKER_URL || "https://balasoftware.in").replace(/\/+$/, "");
const configInterval = Math.max(3000, Number(process.env.BRIDGE_CONFIG_INTERVAL_MS || 5000));
const recordingRoot = process.env.STORAGE_ROOT || path.join(process.cwd(), "recordings");
const hlsRoot = path.join(recordingRoot, "hls");
// Recordings are always saved as one file per clock hour. Values below 3600 are ignored
// so 1-minute / 5-minute segmenting can never be reintroduced through configuration.
const segmentSeconds = Math.max(3600, Number(process.env.RECORDING_SEGMENT_SECONDS || 3600));
const indexDays = Math.max(1, Number(process.env.RECORDING_INDEX_DAYS || 31));
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
const transportArgs = (source) => /^rtsps?:\/\//i.test(String(source || "")) ? ["-rtsp_transport", "tcp"] : [];
const redact = (text, source) => String(text || "").split(source).join("[redacted-source]").slice(-1200);
const newDate = () => new Date();
const datePart = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const timePart = (date) => `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:${String(date.getSeconds()).padStart(2, "0")}`;
const cameraFolder = (camera) => `Camera-${Number(camera.id)}`;
const dayFolder = (root, folder, day) => path.join(root, "recordings", folder, day);

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
      hlsFps: null,
      hlsBitrate: null,
      hlsResolution: null,
      hlsSpeed: null,
      hlsStartedAt: null,
      hlsLastStatsAt: null,
      hlsRestartTimer: null,
      hlsLastHealAt: 0,
      recordDesired: false,
      recordProcess: null,
      recordStatus: "stopped",
      recordError: "",
      recordRestarts: 0,
      recordGeneration: 0,
      recordSource: "",
      recordActive: false,
      recordSuppressed: false,
      recordIndex: null,
      lastRecordingAt: null,
      sourceResolution: null,
      sourceFps: null,
      probedSource: "",
      sourceProbedAt: null,
      sourceProbeError: "",
      aiDesired: false,
      aiLoopActive: false,
      aiError: null,
      lastAiFrameAt: null,
      aiDetections: 0,
      aiFrameProcess: null,
      aiFrameSource: "",
      aiLatestFrame: null
    };
    sessions.set(Number(id), session);
  }
  if (camera) session.camera = camera;
  return session;
};

const probeSource = (session, source) => {
  if (!source || session.probedSource === source) return;
  session.probedSource = source;
  session.sourceProbeError = "";
  execFile(ffmpegPath, [
    "-hide_banner", "-loglevel", "info", ...transportArgs(source),
    "-analyzeduration", "2000000", "-probesize", "2000000",
    "-i", source
  ], { timeout: 20000, encoding: "utf8", windowsHide: true }, (error, stdout, stderr) => {
    const text = `${stdout || ""}${stderr || ""}`;
    const line = text.split(/\r?\n/).find((entry) => entry.includes("Video:")) || "";
    const size = line.match(/(\d{2,5})x(\d{2,5})/);
    const fps = line.match(/([\d.]+)\s*fps/) || line.match(/\btbr\s+([\d.]+)/);
    if (size) session.sourceResolution = `${size[1]}x${size[2]}`;
    if (fps) session.sourceFps = Number(fps[1]) || session.sourceFps;
    session.sourceProbedAt = new Date().toISOString();
    if (error && !session.sourceResolution) session.sourceProbeError = String(error.message || error).slice(0, 200);
  });
};

const startHls = (session) => {
  const camera = session.camera;
  if (!camera?.enabled || !camera.source) return;
  if (session.hlsRestartTimer) {
    clearTimeout(session.hlsRestartTimer);
    session.hlsRestartTimer = null;
  }
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
  probeSource(session, camera.source);
  session.hlsError = "";
  session.hlsStatus = "starting";
  session.hlsFps = null;
  session.hlsBitrate = null;
  session.hlsResolution = null;
  session.hlsSpeed = null;
  session.hlsStartedAt = new Date().toISOString();
  session.hlsLastStatsAt = null;
  const dir = path.join(hlsRoot, String(session.id));
  mkdirSync(dir, { recursive: true });
  const playlist = path.join(dir, "index.m3u8");
  const encoderArgs = videoEncoder === "libx264"
    ? ["-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency", "-pix_fmt", "yuv420p"]
    : ["-c:v", videoEncoder, "-preset", "fast", "-pix_fmt", "yuv420p"];
  const args = [
    "-hide_banner", "-stats", "-loglevel", "error", ...transportArgs(camera.source),
    "-thread_queue_size", "512", "-fflags", "nobuffer+genpts", "-flags", "low_delay",
    "-analyzeduration", "500000", "-probesize", "500000",
    "-i", camera.source, "-an",
    ...encoderArgs,
    "-g", "30", "-keyint_min", "30", "-sc_threshold", "0",
    "-f", "hls", "-hls_time", "1", "-hls_list_size", "4",
    "-hls_flags", "delete_segments+append_list+independent_segments+omit_endlist",
    "-hls_segment_filename", path.join(dir, "seg-%06d.ts"), "-y", playlist
  ];
  const child = spawn(ffmpegPath, args, { stdio: ["ignore", "ignore", "pipe"] });
  session.hlsProcess = child;
  child.stderr.on("data", (chunk) => {
    const text = String(chunk);
    session.hlsError = redact(`${session.hlsError}${text}`, camera.source).slice(-1000);
    const fpsMatch = text.match(/fps=\s*([\d.]+)/);
    if (fpsMatch) session.hlsFps = Number(fpsMatch[1]);
    const bitrateMatch = text.match(/bitrate=\s*([\d.]+)\s*kbits\/s/);
    if (bitrateMatch) session.hlsBitrate = Number(bitrateMatch[1]);
    const speedMatch = text.match(/speed=\s*([\d.]+)x/);
    if (speedMatch) session.hlsSpeed = Number(speedMatch[1]);
    const sizeMatch = text.match(/(\d{3,4})x(\d{3,4})/);
    if (sizeMatch && !session.hlsResolution) session.hlsResolution = `${sizeMatch[1]}x${sizeMatch[2]}`;
    session.hlsLastStatsAt = new Date().toISOString();
  });
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
    if (videoEncoder !== "libx264" && /encoder|nvenc|nvcuda|qsv|vaapi|cannot load|not found/i.test(session.hlsError)) {
      videoEncoder = "libx264";
      session.hlsRestarts = 0;
    }
    if (session.hlsRestartTimer) return;
    session.hlsRestartTimer = setTimeout(() => {
      session.hlsRestartTimer = null;
      startHls(session);
    }, Math.min(10000, 1000 * Math.max(session.hlsRestarts, 1)));
  });
};

const stopHls = (session) => {
  if (session.hlsRestartTimer) {
    clearTimeout(session.hlsRestartTimer);
    session.hlsRestartTimer = null;
  }
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

const recordingUploadHeaders = (item) => {
  const headers = new Headers();
  applyStorageAuth(headers, storageConfig);
  headers.set("Content-Type", "video/mp4");
  headers.set("X-Recording-Camera", String(item.metadata.camera ?? ""));
  headers.set("X-Recording-Date", String(item.metadata.date ?? ""));
  headers.set("X-Recording-Time", String(item.metadata.time ?? ""));
  headers.set("X-Recording-Filename", encodeURIComponent(String(item.metadata.filename ?? "")));
  if (item.metadata.camera_id !== null && item.metadata.camera_id !== undefined) headers.set("X-Recording-Camera-Id", String(item.metadata.camera_id));
  if (item.metadata.duration_seconds !== null && item.metadata.duration_seconds !== undefined) headers.set("X-Recording-Duration-Seconds", String(item.metadata.duration_seconds));
  return headers;
};

const uploadRecordingBuffered = async (item) => {
  const bytes = await readFile(item.file);
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: "video/mp4" }), item.metadata.filename);
  form.append("camera_id", String(item.metadata.camera_id));
  form.append("camera", item.metadata.camera);
  form.append("date", item.metadata.date);
  form.append("time", item.metadata.time);
  if (item.metadata.duration_seconds !== null && item.metadata.duration_seconds !== undefined) form.append("duration_seconds", String(item.metadata.duration_seconds));
  const headers = new Headers();
  applyStorageAuth(headers, storageConfig);
  const target = `${storageConfig.endpoint.replace(/\/+$/, "")}/api/storage/upload`;
  const original = new URL(target);
  let current = target;
  let response;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    response = await fetch(current, { method: "POST", headers, body: form, redirect: "manual", signal: AbortSignal.timeout(1800000) });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get("location");
    if (!location) throw new Error(`Storage upload redirected without a target (${response.status})`);
    const redirected = new URL(location, current);
    if (redirected.origin !== original.origin) throw new Error("Storage upload redirect must stay on the same origin");
    current = redirected.toString();
  }
  return response;
};

const finalizeUpload = async (item, response) => {
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

const uploadRecording = async (item) => {
  if (!storageConfig?.endpoint) throw new Error("Storage API is not configured");
  const base = storageConfig.endpoint.replace(/\/+$/, "");
  let response = null;
  try {
    response = await fetch(`${base}/api/storage/upload/raw`, {
      method: "POST",
      headers: recordingUploadHeaders(item),
      body: Readable.toWeb(createReadStream(item.file)),
      duplex: "half",
      signal: AbortSignal.timeout(1800000)
    });
  } catch {
    // Any streaming failure (duplex unsupported, connection torn down by an
    // early 409, reset mid-transfer, ...) falls back to the buffered endpoint
    // below, which always produces a clean response the finalizer can read.
  }
  if (response && (response.status >= 300 && response.status < 400 || [404, 405].includes(response.status))) {
    if (response.body) await response.body.cancel().catch(() => {});
    response = null;
  }
  if (!response) response = await uploadRecordingBuffered(item);
  await finalizeUpload(item, response);
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
  frame_interval_ms: 5000,
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

const JPEG_START = Buffer.from([0xff, 0xd8]);
const JPEG_END = Buffer.from([0xff, 0xd9]);

const stopAiFrames = (session) => {
  const child = session.aiFrameProcess;
  session.aiFrameProcess = null;
  session.aiFrameSource = "";
  session.aiLatestFrame = null;
  if (child && child.exitCode === null) {
    try { child.kill("SIGTERM"); } catch {}
  }
};

const startAiFrames = (session) => {
  const camera = session.camera;
  if (!camera?.source || !camera?.enabled) return;
  if (session.aiFrameProcess && session.aiFrameProcess.exitCode === null) {
    if (session.aiFrameSource === camera.source) return;
    stopAiFrames(session);
  }
  const child = spawn(ffmpegPath, [
    "-hide_banner", "-loglevel", "error", ...transportArgs(camera.source),
    "-thread_queue_size", "512", "-fflags", "nobuffer", "-flags", "low_delay",
    "-analyzeduration", "1000000", "-probesize", "1000000",
    "-i", camera.source, "-an",
    "-vf", "fps=1,scale=640:-2",
    "-c:v", "mjpeg", "-q:v", "6", "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1"
  ], { stdio: ["ignore", "pipe", "pipe"] });
  session.aiFrameProcess = child;
  session.aiFrameSource = camera.source;
  let buffer = Buffer.alloc(0);
  child.stdout.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      const start = buffer.indexOf(JPEG_START);
      if (start < 0) {
        buffer = buffer.subarray(Math.max(0, buffer.length - 3));
        break;
      }
      const end = buffer.indexOf(JPEG_END, start + 2);
      if (end < 0) break;
      session.aiLatestFrame = { frame: Buffer.from(buffer.subarray(start, end + 2)), at: Date.now() };
      buffer = buffer.subarray(end + 2);
    }
  });
  child.stderr.on("data", () => undefined);
  child.once("close", () => {
    if (session.aiFrameProcess !== child) return;
    session.aiFrameProcess = null;
    session.aiFrameSource = "";
    if (session.aiDesired && aiState.running && session.camera?.source && session.camera?.enabled) {
      setTimeout(() => startAiFrames(session), 2000).unref();
    }
  });
};

const latestAiFrame = async (session, timeoutMs = 6000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const latest = session.aiLatestFrame;
    if (latest && Date.now() - latest.at <= 20000) return latest.frame;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("No frame was received from the camera");
};

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
  const frame = await latestAiFrame(session);
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
      bounding_box: (detection.bounding_box || detection.box) ? { ...(detection.bounding_box || detection.box), frame_width: detection.frame_width ?? (detection.bounding_box || detection.box)?.frame_width, frame_height: detection.frame_height ?? (detection.bounding_box || detection.box)?.frame_height } : null,
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
      stopAiFrames(session);
      await new Promise(resolve => setTimeout(resolve, 1000));
      continue;
    }
    try {
      startAiFrames(session);
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
  stopAiFrames(session);
};

const startAi = (session) => {
  session.aiDesired = true;
  if (!session.aiLoopActive) void aiLoop(session);
};

const stopAi = (session) => {
  session.aiDesired = false;
  stopAiFrames(session);
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

const ensureRecordingDirs = (folder) => {
  const now = Date.now();
  for (const offset of [-86400000, 0, 86400000]) {
    mkdirSync(dayFolder(recordingRoot, folder, datePart(new Date(now + offset))), { recursive: true });
  }
};

const recordingTemplate = (folder) => path.join(recordingRoot, "recordings", folder, "%Y-%m-%d", "%H-%M-%S.mp4");

const recordingEncoderArgs = (session) => {
  const fps = Number(session.sourceFps) || 25;
  const gop = String(Math.min(240, Math.max(30, Math.round(fps * 2))));
  if (videoEncoder === "libx264") return ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-g", gop, "-keyint_min", gop, "-sc_threshold", "0"];
  if (videoEncoder === "h264_nvenc") return ["-c:v", "h264_nvenc", "-preset", "p4", "-rc", "vbr", "-cq", "20", "-b:v", "0", "-pix_fmt", "yuv420p", "-g", gop];
  if (videoEncoder === "h264_qsv") return ["-c:v", "h264_qsv", "-preset", "veryfast", "-global_quality", "20", "-pix_fmt", "yuv420p", "-g", gop];
  return ["-c:v", videoEncoder, "-preset", "fast", "-pix_fmt", "yuv420p", "-g", gop];
};

const recordingArgs = (session, source, folder) => [
  "-hide_banner", "-loglevel", "error", ...transportArgs(source),
  "-thread_queue_size", "512", "-fflags", "+genpts",
  "-analyzeduration", "1000000", "-probesize", "1000000",
  "-i", source, "-an",
  ...recordingEncoderArgs(session),
  "-movflags", "+frag_keyframe+empty_moov+default_base_moof",
  "-f", "segment", "-segment_time", String(segmentSeconds),
  "-segment_atclocktime", "1", "-reset_timestamps", "1",
  "-strftime", "1", "-y", recordingTemplate(folder)
];

const indexStateFor = (session) => {
  if (!session.recordIndex) session.recordIndex = { timer: null, busy: false, folder: "", reported: new Map(), queued: new Set() };
  return session.recordIndex;
};

const listRecordingFiles = (folder) => {
  const base = path.join(recordingRoot, "recordings", folder);
  let days = [];
  try { days = readdirSync(base).filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name)).sort(); } catch { return []; }
  const cutoff = datePart(new Date(Date.now() - (indexDays - 1) * 86400000));
  const files = [];
  for (const day of days) {
    if (day < cutoff) continue;
    let names = [];
    try { names = readdirSync(path.join(base, day)); } catch { continue; }
    for (const name of names) {
      if (!name.toLowerCase().endsWith(".mp4")) continue;
      try {
        const stat = statSync(path.join(base, day, name));
        files.push({ file: path.join(base, day, name), name, day, size: stat.size, mtime: stat.mtimeMs });
      } catch {}
    }
  }
  files.sort((left, right) => `${left.day}T${left.name}`.localeCompare(`${right.day}T${right.name}`));
  return files;
};

const segmentStartMs = (day, name) => {
  const time = String(name).slice(0, 8).replace(/-/g, ":");
  const value = new Date(`${day}T${time}`).getTime();
  return Number.isFinite(value) ? value : null;
};

const indexRecordings = async (session, folder, final = false) => {
  const state = indexStateFor(session);
  if (state.busy || !folder) return;
  state.busy = true;
  state.folder = folder;
  try {
    const files = listRecordingFiles(folder);
    const now = Date.now();
    const camera = session.camera;
    for (let index = 0; index < files.length; index += 1) {
      const entry = files[index];
      const recorderAlive = !!session.recordProcess && session.recordProcess.exitCode === null;
      const isOpen = index === files.length - 1 && !final && (recorderAlive || now - entry.mtime < 60000);
      const status = isOpen ? "recording" : "ready";
      const previous = state.reported.get(entry.name);
      const changed = !previous || previous.size !== entry.size || previous.status !== status;
      const due = changed && (!isOpen || !previous || now - (previous.at ?? 0) >= 15000);
      const uploadDue = !isOpen && storageConfig?.endpoint && !!camera?.source && !state.queued.has(entry.name);
      if (!due && !uploadDue) continue;
      const startMs = segmentStartMs(entry.day, entry.name);
      const next = files[index + 1];
      let duration = null;
      if (!isOpen) {
        const endMs = next ? segmentStartMs(next.day, next.name) : entry.mtime;
        duration = startMs && endMs > startMs
          ? Math.max(1, Math.min(segmentSeconds, Math.round((endMs - startMs) / 1000)))
          : segmentSeconds;
      }
      const metadata = {
        camera_id: Number(camera?.id ?? session.id),
        name: safeName(camera?.name ?? "Camera"),
        camera: folder,
        date: entry.day,
        time: startMs ? timePart(new Date(startMs)) : "00:00:00",
        filename: entry.name,
        duration_seconds: duration,
        size_bytes: entry.size,
        status,
        started_at: startMs ? new Date(startMs).toISOString() : new Date(entry.mtime).toISOString(),
        ended_at: isOpen || !startMs || !duration ? null : new Date(startMs + duration * 1000).toISOString()
      };
      if (due) {
        try {
          await reportRecording(metadata);
          state.reported.set(entry.name, { size: entry.size, status, at: Date.now() });
        } catch {}
      }
      if (uploadDue) {
        state.queued.add(entry.name);
        void queueUpload(session, camera, entry.file, metadata).catch(() => undefined);
      }
      if (metadata.ended_at) session.lastRecordingAt = metadata.ended_at;
      else session.lastRecordingAt = metadata.started_at;
    }
  } finally {
    state.busy = false;
  }
};

const startIndexing = (session, folder) => {
  const state = indexStateFor(session);
  state.folder = folder;
  if (state.timer) clearInterval(state.timer);
  state.timer = setInterval(() => { void indexRecordings(session, state.folder, false); }, 5000);
  state.timer.unref();
  void indexRecordings(session, folder, false);
};

const stopIndexing = (session) => {
  const state = session.recordIndex;
  if (!state?.timer) return;
  clearInterval(state.timer);
  state.timer = null;
};

const runRecorder = async (session, generation) => {
  session.recordActive = true;
  try {
    while (session.recordDesired && session.recordGeneration === generation && session.camera?.source) {
      const camera = session.camera;
      const folder = cameraFolder(camera);
      ensureRecordingDirs(folder);
      probeSource(session, camera.source);
      let stderr = "";
      const child = spawn(ffmpegPath, recordingArgs(session, camera.source, folder), { stdio: ["pipe", "ignore", "pipe"] });
      session.recordProcess = child;
      session.recordStatus = "starting";
      startIndexing(session, folder);
      child.stderr.on("data", (chunk) => { stderr = redact(`${stderr}${chunk}`, camera.source).slice(-1200); });
      child.once("spawn", () => {
        if (session.recordProcess === child && session.recordGeneration === generation) {
          session.recordStatus = "recording";
          session.recordError = "";
        }
      });
      const code = await new Promise((resolve) => {
        child.once("error", (error) => { stderr = redact(`${stderr}${error.message}`, camera.source); resolve(-1); });
        child.once("close", (value) => resolve(value ?? 0));
      });
      if (session.recordProcess === child) session.recordProcess = null;
      stopIndexing(session);
      if (session.recordGeneration !== generation || !session.recordDesired) return;
      await indexRecordings(session, folder, false).catch(() => undefined);
      if (code === 0) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        continue;
      }
      session.recordStatus = "reconnecting";
      session.recordError = stderr || `Recording failed (${code})`;
      session.recordRestarts += 1;
      if (videoEncoder !== "libx264" && /encoder|nvenc|nvcuda|qsv|vaapi|cannot load|not found|unknown/i.test(stderr)) {
        videoEncoder = "libx264";
        session.recordRestarts = 0;
        session.recordError = "";
      }
      await new Promise((resolve) => setTimeout(resolve, Math.min(10000, 500 * Math.max(session.recordRestarts, 1))));
    }
  } finally {
    if (session.recordGeneration === generation) session.recordActive = false;
  }
};

const startRecording = (session) => {
  if (!session.camera?.source) throw new Error("No RTSP source is configured for this camera");
  if (session.recordDesired && session.recordStatus !== "stopped" && session.recordActive && session.recordSource === session.camera.source) return;
  if (session.recordDesired && session.recordStatus !== "stopped") {
    session.recordGeneration += 1;
    const previous = session.recordProcess;
    session.recordProcess = null;
    if (previous && previous.exitCode === null) {
      try { previous.kill("SIGTERM"); } catch {}
    }
    stopIndexing(session);
    session.recordDesired = false;
    session.recordStatus = "stopped";
  }
  session.recordGeneration += 1;
  session.recordDesired = true;
  session.recordStatus = "starting";
  session.recordError = "";
  session.recordSource = session.camera.source;
  void runRecorder(session, session.recordGeneration);
};

const stopRecording = (session) => {
  if (!session.recordDesired && session.recordStatus === "stopped" && !session.recordProcess) return;
  session.recordGeneration += 1;
  session.recordDesired = false;
  session.recordStatus = "stopped";
  const folder = session.recordIndex?.folder || (session.camera ? cameraFolder(session.camera) : "");
  stopIndexing(session);
  const child = session.recordProcess;
  session.recordProcess = null;
  let finalScheduled = false;
  const scheduleFinalIndex = (delay) => {
    setTimeout(() => {
      if (finalScheduled) return;
      finalScheduled = true;
      if (folder) void indexRecordings(session, folder, true).catch(() => undefined);
    }, delay).unref();
  };
  if (child && child.exitCode === null) {
    try { child.stdin?.write("q\n"); } catch {}
    const termTimer = setTimeout(() => { try { if (child.exitCode === null) child.kill("SIGTERM"); } catch {} }, 2000);
    termTimer.unref();
    // Index only once the recorder process is really gone so a still-open file
    // can never be handed to storage mid-write.
    child.once("close", () => { clearTimeout(termTimer); scheduleFinalIndex(1000); });
    scheduleFinalIndex(15000);
  } else {
    scheduleFinalIndex(3500);
  }
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
    // An explicit local/worker stop stays in effect across config reloads; only an
    // explicit start (or disabling the camera) clears it.
    if (camera.recording_enabled && !session.recordSuppressed) startRecording(session);
    else if (!camera.recording_enabled) {
      session.recordSuppressed = false;
      stopRecording(session);
    }
    if (camera.enabled && camera.ai_enabled !== false) startAi(session);
    else stopAi(session);
  }
  for (const [id, session] of sessions) {
    if (nextIds.has(id)) continue;
    stopHls(session);
    session.recordSuppressed = false;
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
  "-hide_banner", "-loglevel", "error", ...transportArgs(url),
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
  let status = session.hlsStatus === "online" ? (lastFrameAt ? "online" : "starting") : session.hlsStatus;
  if (status === "online" && lastFrameAt && Date.now() - Date.parse(lastFrameAt) > 8000) status = "reconnecting";
  if (status === "online" && !lastFrameAt && session.hlsStartedAt && Date.now() - Date.parse(session.hlsStartedAt) > 8000) status = "reconnecting";
  return {
    camera_id: session.id,
    status,
    message: session.hlsError || configError || null,
    resolution: session.hlsResolution,
    fps: session.hlsFps,
    bitrate_kbps: session.hlsBitrate,
    speed: session.hlsSpeed,
    last_frame_at: lastFrameAt || session.hlsLastStatsAt,
    restarts: session.hlsRestarts,
    uptime_seconds: session.hlsStartedAt ? Math.max(0, (Date.now() - new Date(session.hlsStartedAt).getTime()) / 1000) : null,
    source_resolution: session.sourceResolution ?? null,
    source_fps: session.sourceFps ?? null,
    recording: session.recordStatus,
    recording_error: session.recordError || queueErrors[0] || null,
    last_recording_at: session.lastRecordingAt
  };
};

const readPlaylist = (file) => {
  if (!existsSync(file) || statSync(file).size <= 0) return null;
  let lines;
  try { lines = readFileSync(file, "utf8").split(/\r?\n/).map(line => line.trim()).filter(Boolean); } catch { return null; }
  const out = [];
  let kept = 0;
  let dropped = 0;
  for (const line of lines) {
    if (!line.endsWith(".ts")) {
      out.push(line);
      continue;
    }
    const segmentFile = path.join(path.dirname(file), path.basename(line));
    if (existsSync(segmentFile)) {
      out.push(line);
      kept += 1;
    } else {
      dropped += 1;
      if (out.length && out[out.length - 1].startsWith("#EXTINF")) out.pop();
    }
  }
  if (!kept) return null;
  if (dropped > 0) {
    const index = out.findIndex(line => line.startsWith("#EXT-X-MEDIA-SEQUENCE:"));
    if (index >= 0) {
      const current = Number(out[index].split(":")[1]) || 0;
      out[index] = `#EXT-X-MEDIA-SEQUENCE:${current + dropped}`;
    }
  }
  if (!out.includes("#EXTM3U")) out.unshift("#EXTM3U");
  return Buffer.from(out.join("\n") + "\n");
};

const hlsPlaylist = async (response, session) => {
  const file = path.join(hlsRoot, String(session.id), "index.m3u8");
  const startedAt = Date.now();
  const deadline = startedAt + 4000;
  let playlist = null;
  while (Date.now() < deadline) {
    playlist = readPlaylist(file);
    if (playlist) break;
    if (session.hlsStatus === "stopped" && Date.now() - startedAt > 1000) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const healedAt = session.hlsStartedAt ? Date.now() - Date.parse(session.hlsStartedAt) : 0;
  if (!playlist && ["online", "starting"].includes(session.hlsStatus) && healedAt > 10000 && session.hlsProcess && session.hlsProcess.exitCode === null && Date.now() - session.hlsLastHealAt > 15000) {
    session.hlsLastHealAt = Date.now();
    try { session.hlsProcess.kill("SIGTERM"); } catch {}
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

const systemMetrics = () => {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  let rx = 0, tx = 0;
  if (process.platform === "linux") {
    try {
      const dev = readFileSync("/proc/net/dev", "utf8");
      for (const line of dev.split("\n").slice(2)) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 10 || !parts[0].endsWith(":")) continue;
        rx += Number(parts[1]) || 0;
        tx += Number(parts[9]) || 0;
      }
    } catch {}
  }
  return {
    platform: process.platform,
    cpu_count: os.cpus().length,
    load_average: os.loadavg(),
    memory_total_bytes: totalMem,
    memory_free_bytes: freeMem,
    memory_used_bytes: totalMem - freeMem,
    network_rx_bytes: rx,
    network_tx_bytes: tx,
    uptime_seconds: os.uptime()
  };
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

  if (pathname === "/system" && request.method === "GET") {
    sendJson(response, 200, systemMetrics());
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
        session.recordSuppressed = false;
        startRecording(session);
        sendJson(response, 200, { camera_id: session.id, status: session.recordStatus });
      } catch (error) {
        sendJson(response, 422, { detail: error instanceof Error ? error.message : "Recording could not start" });
      }
      return;
    }
    if (action === "record/stop" && request.method === "POST") {
      session.recordSuppressed = true;
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
        source_resolution: session.sourceResolution ?? null,
        source_fps: session.sourceFps ?? null,
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
