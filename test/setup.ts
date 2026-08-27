import { afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const testMemoryRoot = mkdtempSync(join(tmpdir(), "auto-memories-vitest-"));
process.env.MEMORY_ROOT = testMemoryRoot;
process.env.VECTOR_BACKEND = "js";

afterAll(() => {
  try {
    rmSync(testMemoryRoot, { recursive: true, force: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EBUSY" && code !== "EPERM") throw error;
    // Windows 仍持有 SQLite 文件时，临时目录由操作系统负责回收。
  }
});
