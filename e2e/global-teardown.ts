import { rmSync } from "node:fs";
import { join } from "node:path";

const e2eMemoryRoot = join(process.cwd(), "e2e", ".tmp", "memory-root");

export default async function globalTeardown() {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      rmSync(e2eMemoryRoot, { recursive: true, force: true });
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EBUSY" && code !== "EPERM") throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}
