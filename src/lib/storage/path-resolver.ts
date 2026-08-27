import { env } from "../../config/env";
import { getDatabase } from "./database";
import { join, resolve, isAbsolute } from "path";
import { existsSync, mkdirSync } from "fs";

const ensureDir = (dirPath: string): void => {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
};

/**
 * 数据库文件路径 —— 始终基于 env.MEMORY_ROOT，启动时确定，永不改变。
 *
 * 不依赖 getMemoryRoot()，避免 getMemoryRoot → getDatabase → getDatabasePath 的循环依赖。
 * 数据库留在项目目录（或 env 配置的位置，通常在 SSD 上），笔记可独立迁移到大容量盘。
 */
export const getDatabasePath = (): string => {
  ensureDir(env.MEMORY_ROOT);
  return join(env.MEMORY_ROOT, "memory.db");
};

// ── 笔记根路径：运行时可热重载 ──

let cachedMemoryRoot: string | null = null;

/**
 * 笔记与 Markdown 主存储根目录。
 *
 * 优先从 db 的 storage_config 读取（用户可在设置面板修改）；
 * 若 db 未初始化或无配置，fallback 到 env.MEMORY_ROOT。
 *
 * 结果会被缓存，路径变更后需调用 invalidatePathCache() 失效。
 */
export const getMemoryRoot = (): string => {
  if (cachedMemoryRoot) {
    ensureDir(cachedMemoryRoot);
    return cachedMemoryRoot;
  }

  // 尝试从 db 读取用户配置的笔记路径
  try {
    const db = getDatabase();
    const row = db.prepare("SELECT value FROM config WHERE key = 'storage'").get() as
      { value: string } | undefined;

    if (row) {
      const config = JSON.parse(row.value) as { notesPath?: string };
      if (config.notesPath && config.notesPath.trim()) {
        // 相对路径基于项目根目录解析
        const root = isAbsolute(config.notesPath)
          ? config.notesPath
          : resolve(process.cwd(), config.notesPath);
        ensureDir(root);
        cachedMemoryRoot = root;
        return cachedMemoryRoot;
      }
    }
  } catch {
    // db 未初始化或表不存在，fallback
  }

  // fallback：env.MEMORY_ROOT（相对路径基于 cwd 解析）
  const root = isAbsolute(env.MEMORY_ROOT)
    ? env.MEMORY_ROOT
    : resolve(process.cwd(), env.MEMORY_ROOT);
  ensureDir(root);
  cachedMemoryRoot = root;
  return cachedMemoryRoot;
};

/**
 * 失效笔记路径缓存。
 *
 * 在用户通过设置面板修改 notesPath 后调用，确保后续 getMemoryRoot() 读取新值。
 * 同时失效 PromptCache（画像与系统提示词依赖 profile.md 路径）。
 */
export const invalidatePathCache = (): void => {
  cachedMemoryRoot = null;
};

export const getIndexMapPath = (): string => {
  return join(getMemoryRoot(), "index-map.md");
};

export const getProfilePath = (): string => {
  return join(getMemoryRoot(), "profile.md");
};

export const getNotesPath = (): string => {
  return join(getMemoryRoot(), "notes");
};

export const getTopicPath = (topic: string): string => {
  return join(getNotesPath(), topic);
};

export const getAgentPath = (topic: string): string => {
  return join(getTopicPath(topic), "Agent.md");
};

export const getNotePath = (topic: string, noteId: string): string => {
  return join(getTopicPath(topic), `${noteId}.md`);
};

export const getArchivePath = (): string => {
  return join(getMemoryRoot(), "archive");
};

export const getFailuresPath = (): string => {
  return join(getArchivePath(), "failures");
};

export const getDeletedPath = (): string => {
  return join(getArchivePath(), "deleted");
};
