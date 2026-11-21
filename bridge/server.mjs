import http from "node:http";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import ffmpegPath from "ffmpeg-static";

try {
  for (const line of readFileSync(new URL("./.env", import.meta.url), "utf8").split(/\r?\n/)) {
    const index = line.indexOf("=");
    if (index > 0 && !process.env[line.slice(0, index)]) process.env[line.slice(0, index)] = line.slice(index + 1).trim();
  }
} catch {}

const port = Number(process.env.BRIDGE_PORT || 8792);
const token = process.env.MEDIA_BRIDGE_TOKEN || "";

const authorized = (request) => token && request.headers["x-bridge-token"] === token;

const sourceUrl = (request) => {
  const value = String(request.headers["x-rtsp-url"] || "");
  return /^rtsps?:\/\/\S+$/i.test(value) ? value : null;
};

const ffmpegArgs = (url, snapshot) => [
  "-hide_banner",
  "-loglevel", "error",
  "-rtsp_transport", "tcp",
  "-fflags", "nobuffer",
  "-flags", "low_delay",
  "-analyzeduration", "1000000",
  "-probesize", "1000000",
  "-i", url,
  "-an",
  ...(snapshot ? ["-frames:v", "1"] : ["-vf", "fps=10,scale=640:-2"]),
  "-c:v", "mjpeg",
  "-q:v", "5",
  "-f", "image2pipe",
  "-vcodec", "mjpeg",
  "pipe:1"
];

const writeFrame = (response, frame) => {
  response.write(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`);
  response.write(frame);
  response.write("\r\n");
};

const stream = (request, response, url) => {
  const process = spawn(ffmpegPath, ffmpegArgs(url, false), { stdio: ["ignore", "pipe", "pipe"] });
  let buffer = Buffer.alloc(0);
  let closed = false;
  let stderr = "";
  response.writeHead(200, {
    "content-type": "multipart/x-mixed-replace; boundary=frame",
    "cache-control": "no-store",
    "x-accel-buffering": "no"
  });

  process.stdout.on("data", (chunk) => {
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
        process.stdout.pause();
        response.once("drain", () => process.stdout.resume());
      }
    }
  });

  process.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-1000); });
  process.on("error", (error) => { stderr = `${stderr}\n${error.message}`.slice(-1000); process.kill(); });
  process.on("close", () => { if (!closed) { closed = true; response.end(); } });
  response.on("close", () => { if (!closed) { closed = true; process.kill(); } });
};

const snapshot = (request, response, url) => {
  const process = spawn(ffmpegPath, ffmpegArgs(url, true), { stdio: ["ignore", "pipe", "pipe"] });
  const chunks = [];
  let stderr = "";
  const timer = setTimeout(() => process.kill(), 12000);
  process.stdout.on("data", (chunk) => chunks.push(chunk));
  process.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-1000); });
  process.on("error", (error) => { stderr = `${stderr}\n${error.message}`.slice(-1000); });
  process.on("close", () => {
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

http.createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
    return;
  }
  if (!authorized(request)) {
    response.writeHead(401, { "content-type": "application/json" });
    response.end(JSON.stringify({ detail: "Invalid bridge token" }));
    return;
  }
  const url = sourceUrl(request);
  if (!url) {
    response.writeHead(400, { "content-type": "application/json" });
    response.end(JSON.stringify({ detail: "A valid X-RTSP-URL header is required" }));
    return;
  }
  if (request.url === "/stream") {
    stream(request, response, url);
    return;
  }
  if (request.url === "/snapshot") {
    snapshot(request, response, url);
    return;
  }
  response.writeHead(404, { "content-type": "application/json" });
  response.end(JSON.stringify({ detail: "Not found" }));
}).listen(port, "127.0.0.1", () => console.log(`LocalVision media bridge listening on ${port}`));
