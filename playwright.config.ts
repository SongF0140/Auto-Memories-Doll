import { defineConfig } from "@playwright/test";
import { join } from "node:path";

const port = 4173;
const baseURL = `http://127.0.0.1:${port}`;
const e2eMemoryRoot = join(process.cwd(), "e2e", ".tmp", "memory-root");

export default defineConfig({
  testDir: "./e2e",
  globalTeardown: "./e2e/global-teardown.ts",
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: `node e2e/start-server.mjs ${port}`,
    url: `${baseURL}/api/health`,
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      MEMORY_ROOT: e2eMemoryRoot,
      VECTOR_BACKEND: "js",
      NIGHTLY_ENABLED: "false",
      BROWSER_COLLECT_ENABLED: "false",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});
