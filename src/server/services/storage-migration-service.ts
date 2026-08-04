import { promises as fs, existsSync } from "fs";
import { join, resolve, isAbsolute } from "path";
import { ConfigService } from "./config-service";
import { invalidatePathCache, getMemoryRoot } from "../../lib/storage/path-resolver";
import { PromptCache } from "../../lib/prompt/cache";
import { stopFileWatcher, startFileWatcher } from "../watchers/file-watcher";
import { logger } from "../../lib/logger";

/**
 * 笔记存储路径迁移服务。
 *
 * 在用户通过设置面板修改 notesPath 时执行：
 * 1. 验证新路径可写
 * 2. 停止 FileWatcher（避免迁移过程中触发自动入队）
 * 3. 递归复制旧 memory-root 内容到新路径（排除 memory.db 等数据库文件）
 * 4. 更新 storage config
 * 5. invalidatePathCache（让后续 getMemoryRoot() 读取新值）
 * 6. 重启 FileWatcher 监听新路径
 * 7. 失效 PromptCache（profile.md 路径已变）
 *
 * 注意：数据库文件（memory.db*）始终留在 env.MEMORY_ROOT，不参与迁移。
 */
export class StorageMigrationService {
  /** 不参与迁移的文件名（数据库相关，路径固定） */
  private static readonly EXCLUDED_FILES = new Set([
    "memory.db",
    "memory.db-journal",
    "memory.db-wal",
    "memory.db-shm",
  ]);

  /**
   * 执行路径迁移。
   * @param newNotesPath 用户指定的新笔记根目录（可为相对路径，基于 cwd 解析）
   * @param copyExisting 是否复制现有笔记到新路径（true=迁移，false=仅切换）
   */
  async migrate(newNotesPath: string, copyExisting: boolean): Promise<void> {
    const absoluteNewPath = isAbsolute(newNotesPath)
      ? newNotesPath
      : resolve(process.cwd(), newNotesPath);

    // 1. 验证新路径可写
    await this.validateWritable(absoluteNewPath);

    const oldPath = getMemoryRoot();

    // 2. 停止 FileWatcher
    stopFileWatcher();
    logger.storage.info("[StorageMigration] FileWatcher 已停止");

    try {
      // 3. 复制旧目录内容到新路径
      if (copyExisting && oldPath !== absoluteNewPath) {
        await this.copyDirectory(oldPath, absoluteNewPath);
        logger.storage.info("[StorageMigration] 已复制旧笔记到新路径", {
          from: oldPath,
          to: absoluteNewPath,
        });
      }

      // 4. 更新 storage config
      const configService = new ConfigService();
      try {
        configService.setStorageConfig({
          notesPath: newNotesPath,
          updatedAt: new Date().toISOString(),
        });
      } finally {
        configService.close();
      }

      // 5. 失效路径缓存
      invalidatePathCache();
      // 6. 失效 PromptCache（profile.md 路径已变）
      PromptCache.getInstance().invalidateAll();

      logger.storage.info("[StorageMigration] 路径迁移完成", { newPath: absoluteNewPath });
    } finally {
      // 7. 重启 FileWatcher（监听新路径）
      startFileWatcher();
      logger.storage.info("[StorageMigration] FileWatcher 已重启");
    }
  }

  /**
   * 验证目标路径可写：尝试创建目录并写入测试文件。
   */
  private async validateWritable(targetPath: string): Promise<void> {
    await fs.mkdir(targetPath, { recursive: true });
    const testFile = join(targetPath, `.amd-write-test-${Date.now()}`);
    await fs.writeFile(testFile, "test");
    await fs.unlink(testFile);
  }

  /**
   * 递归复制目录内容，跳过数据库文件。
   */
  private async copyDirectory(src: string, dest: string): Promise<void> {
    await fs.mkdir(dest, { recursive: true });
    const entries = await fs.readdir(src, { withFileTypes: true });

    for (const entry of entries) {
      // 跳过数据库文件
      if (StorageMigrationService.EXCLUDED_FILES.has(entry.name)) continue;

      const srcPath = join(src, entry.name);
      const destPath = join(dest, entry.name);

      if (entry.isDirectory()) {
        await this.copyDirectory(srcPath, destPath);
      } else if (entry.isFile()) {
        await fs.copyFile(srcPath, destPath);
      }
    }
  }

  /**
   * 预览迁移：返回将被复制的文件数和总大小，供前端确认。
   */
  async previewMigration(newNotesPath: string): Promise<{
    fileCount: number;
    totalBytes: number;
    oldPath: string;
    newPath: string;
  }> {
    const absoluteNewPath = isAbsolute(newNotesPath)
      ? newNotesPath
      : resolve(process.cwd(), newNotesPath);
    const oldPath = getMemoryRoot();

    let fileCount = 0;
    let totalBytes = 0;

    if (existsSync(oldPath)) {
      const stats = await this.scanDirectory(oldPath);
      fileCount = stats.fileCount;
      totalBytes = stats.totalBytes;
    }

    return { fileCount, totalBytes, oldPath, newPath: absoluteNewPath };
  }

  private async scanDirectory(dir: string): Promise<{ fileCount: number; totalBytes: number }> {
    let fileCount = 0;
    let totalBytes = 0;
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (StorageMigrationService.EXCLUDED_FILES.has(entry.name)) continue;

      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        const sub = await this.scanDirectory(fullPath);
        fileCount += sub.fileCount;
        totalBytes += sub.totalBytes;
      } else if (entry.isFile()) {
        fileCount++;
        const stat = await fs.stat(fullPath);
        totalBytes += stat.size;
      }
    }

    return { fileCount, totalBytes };
  }
}
