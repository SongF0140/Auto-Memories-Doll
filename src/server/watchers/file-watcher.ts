import { watch, FSWatcher } from "chokidar";
import { readFileSync } from "fs";
import { getMemoryRoot } from "../../lib/storage/path-resolver";
import { IngestAdapter } from "../../features/ingest/adapter";
import { InputNormalizer } from "../../features/ingest/normalizer";
import { InputParser } from "../../features/ingest/parser";
import { MemoryService } from "../services/memory-service";
import { parseMemoryFromText } from "../../lib/storage/markdown-parser";
import { isRecentWrite } from "../../lib/storage/write-tracker";
import { logger } from "../../lib/logger";

let watcher: FSWatcher | null = null;

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
    await handleNewMarkdown(filePath);
  });

  watcher.on("change", async (filePath) => {
    if (!filePath.endsWith(".md")) return;
    if (filePath.endsWith("index-map.md") || filePath.endsWith("profile.md")) return;
    await handleUpdatedMarkdown(filePath);
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

async function handleNewMarkdown(filePath: string): Promise<void> {
  try {
    // 跳过本进程最近写入的文件，防止 Markdown 写回 → 监听 → 再次入队的循环
    if (isRecentWrite(filePath)) return;

    const content = readFileSync(filePath, "utf-8");
    if (content.length < 10) return;

    const memoryService = new MemoryService();

    try {
      // 检测 LLMWiki frontmatter 格式
      if (content.startsWith("---")) {
        const record = parseMemoryFromText(content);
        if (record) {
          memoryService.stageCreateMemory(
            record.source || filePath,
            record.sourceType,
            record.title,
            record.content,
            record.summary,
            record.tags,
            record.topic,
          );
          logger.ingest.info(`[FileWatcher] 已入队 (LLMWiki): ${filePath} → ${record.id}`);
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
        memoryService.stageCreateMemory(
          record.source,
          record.sourceType,
          record.title,
          record.content,
          record.summary,
          record.tags,
          record.topic,
        );
      }

      logger.ingest.info(`[FileWatcher] 已入队: ${filePath} → ${records.length} 条记忆`);
    } finally {
      memoryService.close();
    }
  } catch (error) {
    logger.ingest.error(`[FileWatcher] 导入失败 (${filePath}):`, { error: (error as Error).message });
  }
}

async function handleUpdatedMarkdown(filePath: string): Promise<void> {
  logger.ingest.info(`[FileWatcher] 检测到文件更新: ${filePath}`);
  await handleNewMarkdown(filePath);
}
