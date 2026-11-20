import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const distIndex = fileURLToPath(new URL("../frontend/dist/index.html", import.meta.url));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

const run = (args) => {
  const result = spawnSync(npm, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

if (!existsSync(distIndex)) {
  run(["--prefix", "frontend", "install"]);
  run(["--prefix", "frontend", "run", "build"]);
}
