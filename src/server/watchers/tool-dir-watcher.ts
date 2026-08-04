import { watch, FSWatcher } from "chokidar";
import { statSync } from "fs";
import { ConfigService } from "../services/config-service";
import { ToolWatchSource } from "../../types/config";
import { parseSession } from "../../lib/tools/session-parser";
import { MemoryService } from "../services/memory-service";
import { isRecentWrite } from "../../lib/storage/write-tracker";
import { logger } from "../../lib/logger";

/**
 * 本地工具工作目录监听器。
 *
 * 管理多个监听源（Cursor/Codex/Claude Code 等），每个源对应一个 chokidar watcher。
 * 文件新增/变化时：
 * 1. 跳过本进程写入的文件（防循环）
 * 2. 跳过已处理的文件（基于 路径+msize 去重）
 * 3. 调用 parseSession 按工具类型解析
 * 4. 送入 MemoryService.stageCreateMemory 入队
 *
 * 启动入口在 instrumentation.ts，与 FileWatcher 并行运行。
 */

interface WatcherEntry {
  source: ToolWatchSource;
  watcher: FSWatcher;
}

let entries: WatcherEntry[] = [];

/** 已处理文件记录：path → mtime+size，用于去重 */
const processedFiles = new Map<string, string>();

function fileSignature(filePath: string): string {
  try {
    const stat = statSync(filePath);
    return `${stat.mtimeMs}_${stat.size}`;
  } catch {
    return "";
  }
}

/**
 * 启动所有已启用的工具监听源。
 * 在 instrumentation.ts 中调用。
 */
export async function startToolDirWatcher(): Promise<void> {
  if (entries.length > 0) return; // 已启动

  const configService = new ConfigService();
  let sources: ToolWatchSource[];
  try {
    sources = configService.listEnabledToolSources();
  } finally {
    configService.close();
  }

  if (sources.length === 0) {
    logger.ingest.info("[ToolDirWatcher] 无已启用的监听源，跳过启动");
    return;
  }

  for (const source of sources) {
    await startSingleSource(source);
  }

  logger.ingest.info(`[ToolDirWatcher] 已启动 ${entries.length} 个监听源`);
}

async function startSingleSource(source: ToolWatchSource): Promise<void> {
  try {
    const pattern = source.filePattern || "*.jsonl";
    const watcher = watch(source.path, {
      ignored: ["**/node_modules/**", "**/.git/**"],
      persistent: true,
      ignoreInitial: false, // 启动时扫描已有文件（首次导入历史会话）
      awaitWriteFinish: { stabilityThreshold: 1000, pollInterval: 300 },
      depth: 5,
    });

    // 把 glob 模式转换为 chokidar 的忽略策略
    // 简化处理：直接监听所有文件，在 handler 里按扩展名过滤
    const allowedExts = patternToExtensions(pattern);

    watcher.on("add", async (filePath) => {
      await handleFileEvent(filePath, source, allowedExts);
    });

    watcher.on("change", async (filePath) => {
      await handleFileEvent(filePath, source, allowedExts);
    });

    watcher.on("error", (error) => {
      logger.ingest.error(`[ToolDirWatcher] 监听源 "${source.name}" 错误:`, {
        error: (error as Error).message,
      });
    });

    entries.push({ source, watcher });
    logger.ingest.info(`[ToolDirWatcher] 监听源 "${source.name}" 已启动`, {
      path: source.path,
      toolType: source.toolType,
      pattern,
    });
  } catch (error) {
    logger.ingest.error(`[ToolDirWatcher] 启动监听源 "${source.name}" 失败:`, {
      error: (error as Error).message,
    });
  }
}

function patternToExtensions(pattern: string): string[] {
  // 从 "*.jsonl" 或 "**/*.md" 提取扩展名
  const match = pattern.match(/\*\.(\w+)/);
  if (match) return [`.${match[1]}`];
  // 默认支持 jsonl 和 md
  return [".jsonl", ".md", ".txt", ".json"];
}

async function handleFileEvent(
  filePath: string,
  source: ToolWatchSource,
  allowedExts: string[],
): Promise<void> {
  // 按扩展名过滤
  const ext = filePath.slice(filePath.lastIndexOf("."));
  if (!allowedExts.includes(ext)) return;

  // 跳过本进程写入的文件
  if (isRecentWrite(filePath)) return;

  // 去重：相同 mtime+size 的文件不重复处理
  const sig = fileSignature(filePath);
  const key = `${source.id}:${filePath}`;
  if (sig && processedFiles.get(key) === sig) return;
  processedFiles.set(key, sig);

  // 防止 processedFiles 无限增长
  if (processedFiles.size > 5000) {
    const keys = [...processedFiles.keys()].slice(0, 2500);
    for (const k of keys) processedFiles.delete(k);
  }

  try {
    const session = await parseSession(filePath, source.toolType);
    if (!session || session.messageCount === 0) return;

    const topic = source.topic || defaultTopicForTool(source.toolType);
    const tags = [source.toolType, "tool-session"];
    if (source.topic) tags.push(source.topic);

    const memoryService = new MemoryService();
    try {
      memoryService.stageCreateMemory(
        `${source.name}:${filePath}`,
        "ingest",
        session.title,
        session.content,
        session.content.slice(0, 200),
        tags,
        topic,
      );
      logger.ingest.info(`[ToolDirWatcher] 已采集会话`, {
        source: source.name,
        title: session.title,
        messages: session.messageCount,
      });
    } finally {
      memoryService.close();
    }
  } catch (error) {
    logger.ingest.error(`[ToolDirWatcher] 解析文件失败: ${filePath}`, {
      error: (error as Error).message,
    });
  }
}

function defaultTopicForTool(toolType: string): string {
  switch (toolType) {
    case "codex":
      return "codex-sessions";
    case "claude-code":
      return "claude-code-sessions";
    case "cursor":
      return "cursor-sessions";
    default:
      return "tool-sessions";
  }
}

/**
 * 停止所有监听源。
 */
export function stopToolDirWatcher(): void {
  for (const entry of entries) {
    try {
      entry.watcher.close();
    } catch {
      // ignore
    }
  }
  entries = [];
  logger.ingest.info("[ToolDirWatcher] 已停止所有监听源");
}

/**
 * 重启所有监听源（在监听源配置变更后调用）。
 */
export async function restartToolDirWatcher(): Promise<void> {
  stopToolDirWatcher();
  await startToolDirWatcher();
}

/**
 * 获取当前活跃的监听源列表（供 API 状态查询）。
 */
export function getActiveSources(): { id: string; name: string; toolType: string; path: string }[] {
  return entries.map((e) => ({
    id: e.source.id,
    name: e.source.name,
    toolType: e.source.toolType,
    path: e.source.path,
  }));
}
