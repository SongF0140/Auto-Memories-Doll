import { watch, FSWatcher } from "chokidar";
import { readFile } from "fs/promises";
import { createHash } from "crypto";
import { resolve } from "path";
import { MemoryRecord } from "../../types/memory";
import { getMemoryRoot } from "../../lib/storage/path-resolver";
import { IngestAdapter } from "../../features/ingest/adapter";
import { InputNormalizer } from "../../features/ingest/normalizer";
import { InputParser } from "../../features/ingest/parser";
import { MemoryService } from "../services/memory-service";
import { parseMemoryFromText } from "../../lib/storage/markdown-parser";
import { isRecentWrite } from "../../lib/storage/write-tracker";
import { logger } from "../../lib/logger";

let watcher: FSWatcher | null = null;
const inFlightIngests = new Map<string, Promise<void>>();

export function startFileWatcher(): void {
  if (watcher) return;

  const watchPaths = [getMemoryRoot()];
  const ignored = ["**/memory.db", "**/memory.db-journal", "**/memory.db-wal", "**/archive/**"];

  watcher = watch(watchPaths, {
    ignored,
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 200 },
  });

  watcher.on("add", async (filePath) => {
    if (!filePath.endsWith(".md")) return;
    if (filePath.endsWith("index-map.md") || filePath.endsWith("profile.md")) return;
    await ingestMarkdownFile(filePath, "add");
  });

  watcher.on("change", async (filePath) => {
    if (!filePath.endsWith(".md")) return;
    if (filePath.endsWith("index-map.md") || filePath.endsWith("profile.md")) return;
    await ingestMarkdownFile(filePath, "change");
  });

  watcher.on("error", (error) => {
    logger.ingest.error("[FileWatcher] 监听错误:", { error: (error as Error).message });
  });

  logger.ingest.info(`[FileWatcher] 已启动，监听目录: ${watchPaths.join(", ")}`);
}

export function stopFileWatcher(): void {
  if (watcher) {
    watcher.close();
    watcher = null;
    logger.ingest.info("[FileWatcher] 已停止");
  }
}

type MarkdownFileEvent = "add" | "change";

/**
 * 将文件路径映射为稳定 ID，供没有 frontmatter 的外部 Markdown 使用。
 * 同一路径的 add/change 始终落到同一个 memoryId，避免每次修改都新建记忆。
 */
function getStableFileMemoryId(filePath: string): string {
  const resolvedPath = resolve(filePath).replace(/\\/g, "/");
  return `file-${createHash("sha256").update(resolvedPath).digest("hex").slice(0, 32)}`;
}

function getFileUpdates(record: MemoryRecord, filePath: string): Partial<MemoryRecord> {
  return {
    source: record.source || filePath,
    sourceType: record.sourceType,
    title: record.title,
    titleZh: record.titleZh,
    content: record.content,
    summary: record.summary,
    summaryZh: record.summaryZh,
    tags: record.tags,
    tagsZh: record.tagsZh,
    topic: record.topic,
    topicZh: record.topicZh,
    graphLinks: record.graphLinks,
  };
}

/**
 * 处理外部 Markdown：add 创建；change 在记录存在时更新，不存在时按稳定 ID 创建。
 * 导出该边界以便集成测试直接验证文件事件与持久化队列的契约。
 */
export async function ingestMarkdownFile(
  filePath: string,
  eventType: MarkdownFileEvent,
): Promise<void> {
  const ingestKey = resolve(filePath);
  const active = inFlightIngests.get(ingestKey);
  if (active) return active;

  const ingest = ingestMarkdownFileOnce(filePath, eventType).finally(() => {
    inFlightIngests.delete(ingestKey);
  });
  inFlightIngests.set(ingestKey, ingest);
  return ingest;
}

async function ingestMarkdownFileOnce(
  filePath: string,
  eventType: MarkdownFileEvent,
): Promise<void> {
  try {
    // 跳过本进程最近写入的文件，防止 Markdown 写回 → 监听 → 再次入队的循环
    if (isRecentWrite(filePath)) return;

    const content = await readFile(filePath, "utf-8");
    if (content.length < 10) return;

    const memoryService = new MemoryService();

    try {
      // 检测 LLMWiki frontmatter 格式
      if (content.startsWith("---")) {
        const record = parseMemoryFromText(content);
        if (record) {
          const stableRecord: MemoryRecord = {
            ...record,
            id: record.id || getStableFileMemoryId(filePath),
            source: record.source || filePath,
          };
          const existing = memoryService.getMemory(stableRecord.id);

          if (eventType === "change" && existing) {
            memoryService.stageUpdateMemory(
              stableRecord.id,
              getFileUpdates(stableRecord, filePath),
            );
          } else {
            memoryService.stageCreateMemoryRecord(stableRecord);
          }

          logger.ingest.info(
            `[FileWatcher] 已入队 (${eventType}, LLMWiki): ${filePath} → ${stableRecord.id}`,
          );
          return;
        }
      }

      // 回退：纯文本/无 frontmatter 格式
      const parser = new InputParser();
      const normalizer = new InputNormalizer();
      const adapter = new IngestAdapter();

      const events = [parser.parseText(content)];
      const normalized = normalizer.normalize(events);
      const records = adapter.adaptBatch(normalized);

      for (const record of records) {
        const stableRecord: MemoryRecord = {
          ...record,
          id: getStableFileMemoryId(filePath),
          source: filePath,
        };
        const existing = memoryService.getMemory(stableRecord.id);
        if (eventType === "change" && existing) {
          memoryService.stageUpdateMemory(stableRecord.id, getFileUpdates(stableRecord, filePath));
        } else {
          memoryService.stageCreateMemoryRecord(stableRecord);
        }
      }

      logger.ingest.info(
        `[FileWatcher] 已入队 (${eventType}): ${filePath} → ${records.length} 条记忆`,
      );
    } finally {
      memoryService.close();
    }
  } catch (error) {
    logger.ingest.error(`[FileWatcher] 导入失败 (${filePath}):`, {
      error: (error as Error).message,
    });
  }
}
