import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const databaseName = "localvision";
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

const run = (command, args, options = {}) => {
  const useInput = options.input !== undefined;
  const result = spawnSync(command, args, {
    cwd: root,
    shell: process.platform === "win32",
    stdio: useInput ? ["pipe", "inherit", "inherit"] : "inherit",
    input: options.input
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
  return result;
};

const capture = (command, args) =>
  spawnSync(command, args, {
    cwd: root,
    shell: process.platform === "win32",
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });

const whoami = capture("npx", ["wrangler", "whoami"]);
if (whoami.status !== 0) {
  console.error("Cloudflare login required. Run: npx wrangler login");
  process.exit(1);
}

console.log("Applying database schema...");
run("npx", ["wrangler", "d1", "execute", databaseName, "--remote", "--file=cloudflare/schema.sql"]);

const columns = capture("npx", ["wrangler", "d1", "execute", databaseName, "--remote", "--command", "PRAGMA table_info(cameras);"]);
const columnText = `${columns.stdout || ""}${columns.stderr || ""}`;
if (!columnText.includes("import_endpoint")) {
  console.log("Applying camera import migration...");
  run("npx", ["wrangler", "d1", "execute", databaseName, "--remote", "--file=cloudflare/migrations/0001_camera_import.sql"]);
}

const tables = capture("npx", ["wrangler", "d1", "execute", databaseName, "--remote", "--command", "SELECT name FROM sqlite_master WHERE type='table' AND name='camera_recordings';"]);
const tableText = `${tables.stdout || ""}${tables.stderr || ""}`;
if (!tableText.includes("camera_recordings")) {
  console.log("Applying camera recordings migration...");
  run("npx", ["wrangler", "d1", "execute", databaseName, "--remote", "--file=cloudflare/migrations/0002_camera_recordings.sql"]);
}

const secrets = capture("npx", ["wrangler", "secret", "list", "--json"]);
const secretText = `${secrets.stdout || ""}${secrets.stderr || ""}`;

if (!secretText.includes("ENCRYPTION_KEY")) {
  console.log("Creating encryption key...");
  run("npx", ["wrangler", "secret", "put", "ENCRYPTION_KEY"], { input: randomBytes(32).toString("hex") });
}
if (!secretText.includes("SECRET_KEY")) {
  run("npx", ["wrangler", "secret", "put", "SECRET_KEY"], { input: randomBytes(32).toString("hex") });
}
if (!secretText.includes("ADMIN_PASSWORD")) {
  console.log("Set the initial admin password when prompted.");
  run("npx", ["wrangler", "secret", "put", "ADMIN_PASSWORD"]);
}
if (!secretText.includes("MEDIA_BRIDGE_TOKEN")) {
  console.log("Set the media bridge token when prompted (use the same value as bridge/.env).");
  run("npx", ["wrangler", "secret", "put", "MEDIA_BRIDGE_TOKEN"]);
}

console.log("Building frontend...");
run(npm, ["run", "build"]);

console.log("Deploying Worker...");
run("npx", ["wrangler", "deploy"]);

console.log("After the deploy succeeds, add the route balasoftware.in/* to the localvision Worker.");
