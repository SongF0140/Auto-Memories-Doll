import { env } from "../../config/env";
import { join } from "path";
import { promises as fs, constants } from "fs";

const lockPath = join(env.MEMORY_ROOT, ".lock");

/**
 * 原子文件锁 —— 使用 fs.open(path, 'wx') 一次性创建，消除 TOCTOU 竞态
 * 'wx' 标记表示：
 *   - w: 以写入打开
 *   - x: 文件必须不存在，如已存在则失败（EXCL 语义）
 * 在 POSIX 和 Windows 上均为原子操作，不存在 access + writeFile 的竞态窗口
 */
export const acquireLock = async (timeout: number = 5000): Promise<boolean> => {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    try {
      const fd = await fs.open(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL);
      await fd.writeFile(process.pid.toString());
      await fd.close();
      return true;
    } catch (err: any) {
      // EEXIST / EACCES: 锁已被占用，等待后重试
      if (err.code === "EEXIST" || err.code === "EACCES") {
        await new Promise((resolve) => setTimeout(resolve, 100));
        continue;
      }
      // 其他 IO 错误（磁盘满、权限不足等）直接失败
      return false;
    }
  }
  return false;
};

export const releaseLock = async (): Promise<void> => {
  try {
    await fs.unlink(lockPath);
  } catch {
    // 锁文件可能已被移除，忽略
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
