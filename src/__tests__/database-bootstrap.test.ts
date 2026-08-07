import { existsSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const envState = vi.hoisted(() => ({ memoryRoot: "" }));

vi.mock("../config/env", () => ({
  env: {
    NODE_ENV: "test",
    MODEL_API_KEY: "",
    MODEL_BASE_URL: "http://localhost:8080",
    get MEMORY_ROOT() {
      return envState.memoryRoot;
    },
    PORT: 3000,
  },
}));

describe("database bootstrap", () => {
  let tempRoot: string;
  let closeDatabase: (() => void) | undefined;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "auto-memories-db-"));
    envState.memoryRoot = join(tempRoot, "missing", "memory-root");
    closeDatabase = undefined;
    vi.resetModules();
  });

  afterEach(() => {
    closeDatabase?.();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it("creates a missing memory root before opening SQLite", async () => {
    const databaseModule = await import("../lib/storage/database");
    closeDatabase = databaseModule.closeDatabase;

    const database = databaseModule.getDatabase();
    const row = database.prepare("SELECT 1 AS value").get() as { value: number };

    expect(row.value).toBe(1);
    expect(existsSync(join(envState.memoryRoot, "memory.db"))).toBe(true);
  });
});
