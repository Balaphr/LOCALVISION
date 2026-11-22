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
const segmentSeconds = Math.max(30, Number(process.env.RECORDING_SEGMENT_SECONDS || 300));

const cameras = new Map();
const sessions = new Map();
const uploadQueue = new Map();
let storageConfig = null;
let configLoadedAt = 0;
let configError = "";
let uploading = false;

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
      lastRecordingAt: null
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
  form.append("camera", item.metadata.camera);
  form.append("date", item.metadata.date);
  form.append("time", item.metadata.time);
  form.append("duration_seconds", String(item.metadata.duration_seconds));
  const headers = new Headers();
  applyStorageAuth(headers, storageConfig);
  const target = `${storageConfig.endpoint.replace(/\/+$/, "")}/api/storage/upload`;
  let response = await fetch(target, { method: "POST", headers, body: form, redirect: "manual", signal: AbortSignal.timeout(120000) });
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    const location = response.headers.get("location");
    if (!location) throw new Error(`Storage upload redirected without a target (${response.status})`);
    response = await fetch(new URL(location, target).toString(), { method: "POST", headers, body: form, signal: AbortSignal.timeout(120000) });
  }
  if (!response.ok) throw new Error(`Storage upload failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
  const saved = await response.json();
  await reportRecording({
    ...item.metadata,
    storage_server_id: storageConfig.id,
    storage_recording_id: saved.id || item.metadata.storage_recording_id,
    status: "ready"
  });
  unlinkSync(item.file);
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
  uploadQueue.set(file, { file, metadata, sessionId: session.id, cameraId: camera.id });
  await drainUploadQueue();
};

const recordChunk = async (session, source, file) => {
  const args = [
    "-hide_banner", "-loglevel", "error", "-rtsp_transport", "tcp",
    "-fflags", "nobuffer", "-flags", "low_delay", "-analyzeduration", "1000000", "-probesize", "1000000",
    "-i", source, "-t", String(segmentSeconds), "-an",
    "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-y", file
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
    const filename = `${safeName(camera.name)}_${date}_${time.replace(/:/g, "-")}.mp4`;
    const dir = path.join(recordingRoot, "recordings", safeName(camera.name), date);
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, filename);
    const metadata = {
      camera_id: camera.id,
      name: safeName(camera.name),
      camera: safeName(camera.name),
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
      const result = await recordChunk(session, camera.source, file);
      if (session.recordProcess) session.recordProcess = null;
      if (session.recordGeneration !== generation) {
        if (existsSync(file)) unlinkSync(file);
        return;
      }
      const size = existsSync(file) ? statSync(file).size : 0;
      if (result.code === 0 && size > 0) {
        const durationSeconds = Math.min(segmentSeconds, Math.max(1, Math.round((Date.now() - result.started) / 1000)));
        metadata.duration_seconds = durationSeconds;
        metadata.size_bytes = size;
        metadata.ended_at = new Date().toISOString();
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
  const nextIds = new Set();
  for (const camera of config.cameras || []) {
    nextIds.add(Number(camera.id));
    const session = getSession(camera.id, camera);
    if (camera.enabled) startHls(session);
    else stopHls(session);
    if (camera.recording_enabled) startRecording(session);
    else stopRecording(session);
  }
  for (const [id, session] of sessions) {
    if (nextIds.has(id)) continue;
    stopHls(session);
    stopRecording(session);
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
  for (let attempt = 0; attempt < 40 && (!existsSync(file) || statSync(file).size === 0); attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!existsSync(file)) {
    sendJson(response, 503, { detail: "Live stream is starting or unavailable" });
    return;
  }
  response.writeHead(200, { "content-type": "application/vnd.apple.mpegurl", "cache-control": "no-store" });
  response.end(readFileSync(file));
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

http.createServer((request, response) => {
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

  const hlsMatch = pathname.match(/^\/hls\/(\d+)\/(.+)$/);
  if (hlsMatch && request.method === "GET") {
    const session = getSession(Number(hlsMatch[1]));
    const resource = hlsMatch[2];
    if (resource === "index.m3u8") void hlsPlaylist(response, session);
    else hlsSegment(response, session, resource);
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
