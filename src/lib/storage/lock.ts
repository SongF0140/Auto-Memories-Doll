import { env } from "../../config/env";
import { join } from "path";
import { promises as fs, constants } from "fs";

const lockPath = join(env.MEMORY_ROOT, ".lock");

/**
 * 检查 PID 对应的进程是否仍在运行。
 * Windows: 通过 tasklist 命令检查
 * Unix: 发送信号 0 检测
 */
async function isPidAlive(pid: number): Promise<boolean> {
  try {
    if (process.platform === "win32") {
      const { execSync } = await import("child_process");
      const result = execSync(`tasklist /FI "PID eq ${pid}" /NH`, {
        encoding: "utf-8",
        timeout: 3000,
      });
      return result.includes(`${pid}`);
    }
    // Unix: kill(pid, 0) 不发送信号，只检查进程是否存在
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * 原子文件锁 —— 使用 fs.open(path, 'wx') 一次性创建，消除 TOCTOU 竞态
 * 'wx' 标记表示：
 *   - w: 以写入打开
 *   - x: 文件必须不存在，如已存在则失败（EXCL 语义）
 * 在 POSIX 和 Windows 上均为原子操作，不存在 access + writeFile 的竞态窗口
 *
 * 如果锁文件已存在，检查 PID 是否还活着：如果进程已死，删除遗留锁文件后重试。
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
      if (err.code === "EEXIST" || err.code === "EACCES") {
        // 检查是否遗留锁文件（前一个进程崩溃未清理）
        try {
          const stalePidStr = await fs.readFile(lockPath, "utf-8");
          const stalePid = parseInt(stalePidStr.trim(), 10);
          if (!isNaN(stalePid) && !(await isPidAlive(stalePid))) {
            // PID 已死，删除遗留锁文件
            try {
              await fs.unlink(lockPath);
            } catch {
              /* 可能已被其他进程清理 */
            }
            continue;
          }
        } catch {
          // 无法读取锁文件（可能已被删除），继续重试
          continue;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
        continue;
      }
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
