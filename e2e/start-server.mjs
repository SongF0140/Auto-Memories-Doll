import { spawn, spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { resolve } from "node:path";

const port = process.argv[2] || "4173";
const projectRoot = process.cwd();
const memoryRoot = resolve(projectRoot, "e2e/.tmp/memory-root");
const seedScript = resolve(projectRoot, "e2e/seed.mjs");
const nextCli = resolve(projectRoot, "node_modules/next/dist/bin/next");

const seed = spawnSync(process.execPath, [seedScript], {
  env: process.env,
  stdio: "inherit",
});

if (seed.status !== 0) {
  process.exit(seed.status ?? 1);
}

const server = spawn(
  process.execPath,
  [nextCli, "dev", "--hostname", "127.0.0.1", "--port", port],
  {
    env: process.env,
    stdio: "inherit",
    windowsHide: true,
  },
);

let stopping = false;

function stop(signal) {
  if (stopping) return;
  stopping = true;
  server.kill(signal);
}

process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));

server.on("exit", (code, signal) => {
  try {
    rmSync(memoryRoot, { recursive: true, force: true });
  } catch {
    // Windows 仍持有 SQLite 文件时，下一次 seed 会重建同一隔离目录。
  }

  process.exit(code ?? (signal ? 1 : 0));
});
