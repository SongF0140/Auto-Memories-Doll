import { env } from "../../config/env";
import { join } from "path";
import { promises as fs } from "fs";

const lockPath = join(env.MEMORY_ROOT, ".lock");

export const acquireLock = async (timeout: number = 5000): Promise<boolean> => {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    try {
      await fs.access(lockPath);
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch {
      await fs.writeFile(lockPath, process.pid.toString());
      return true;
    }
  }
  return false;
};

export const releaseLock = async (): Promise<void> => {
  try {
    await fs.unlink(lockPath);
  } catch {
    // Lock doesn't exist, ignore
  }
};

export const withLock = async <T>(fn: () => Promise<T>): Promise<T> => {
  await acquireLock();
  try {
    return await fn();
  } finally {
    await releaseLock();
  }
};