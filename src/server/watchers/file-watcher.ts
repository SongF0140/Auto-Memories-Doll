import { watch, FSWatcher } from "chokidar";
import { readFile, readdir } from "fs/promises";
import { createHash } from "crypto";
import { join, resolve } from "path";
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

// 运行状态存 globalThis：Next.js dev 把 instrumentation/listener 与路由编译成独立
// 模块实例，模块级 let watcher 在路由 bundle 里是空副本，跨 bundle 查状态必须走 globalThis
const globalStore = globalThis as typeof globalThis & { __amdFileWatcherRunning?: boolean };

export function startFileWatcher(): void {
  // watcher 为空但 globalThis 标记为运行中：说明本模块实例被热重载重建，
  // 真实 watcher 仍在旧实例里活着，跳过以免同进程双监听
  if (watcher || globalStore.__amdFileWatcherRunning) return;

  const watchPaths = [getMemoryRoot()];
  const ignored = [
    "**/memory.db",
    "**/memory.db-journal",
    "**/memory.db-wal",
    "**/archive/**",
    "**/notes/**",
  ];

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

  globalStore.__amdFileWatcherRunning = true;

  logger.ingest.info(`[FileWatcher] 已启动，监听目录: ${watchPaths.join(", ")}`);
}

export function stopFileWatcher(): void {
  if (watcher) {
    watcher.close();
    watcher = null;
    globalStore.__amdFileWatcherRunning = false;
    logger.ingest.info("[FileWatcher] 已停止");
  }
}

/**
 * 获取文件监听器运行状态（供 API 状态查询）。
 */
export function getFileWatcherStatus(): { running: boolean; root: string } {
  return { running: globalStore.__amdFileWatcherRunning === true, root: getMemoryRoot() };
}

type MarkdownFileEvent = "add" | "change" | "scan";

/**
 * 立即重扫记忆库目录下所有 Markdown（绕过 chokidar 事件），供「扫描/重建」按钮调用。
 * 跳过 archive/ 与系统文件；imports/ 一并扫描——重建采集卡片后，导入文件的卡片
 * 只能从这里恢复。已入库且未变更的文件在采集层被哈希跳过，不会产生重复 LLM 成本。
 * 返回扫描的文件数。
 */
export async function scanMemoryRoot(): Promise<number> {
  const root = getMemoryRoot();
  let scanned = 0;
  try {
    const all = await readdir(root, { recursive: true });
    for (const rel of all) {
      const normalized = rel.replace(/\\/g, "/");
      if (!normalized.endsWith(".md") && !normalized.endsWith(".markdown")) continue;
      if (normalized.split("/").some((seg) => seg === "archive" || seg === "notes")) continue;
      if (normalized.endsWith("index-map.md") || normalized.endsWith("profile.md")) continue;
      await ingestMarkdownFile(join(root, rel), "scan");
      scanned++;
    }
  } catch (error) {
    logger.ingest.error("[FileWatcher] 扫描记忆库失败:", { error: (error as Error).message });
  }
  return scanned;
}

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
    kind: record.kind,
    evidence: record.evidence,
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
    const relativePath = filePath.replace(/\\/g, "/");
    if (relativePath.split("/").some((segment) => segment === "notes" || segment === "archive"))
      return;
    // 跳过本进程最近写入的文件，防止 Markdown 写回 → 监听 → 再次入队的循环
    if (isRecentWrite(filePath)) return;

    const content = await readFile(filePath, "utf-8");
    if (content.length < 10) return;

    // 来源原文哈希：入库内容是中文重写卡后与原文不可字面比对，靠它判断文件是否变更
    const contentHash = createHash("sha256").update(content).digest("hex");

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
            evidence: {
              text: record.evidence?.text ?? content.slice(0, 500),
              location: record.evidence?.location ?? filePath,
              sourceHash: contentHash,
            },
          };
          const existing = memoryService.getMemory(stableRecord.id);

          if (existing) {
            // 内容未变更（scan/change 重扫）→ 零成本跳过
            const unchanged = existing.evidence?.sourceHash
              ? existing.evidence.sourceHash === contentHash
              : existing.content === content;
            if (unchanged) return;
            // 有变更（或 add 时已存在）→ 统一走更新事件，由审计流程决定合并/冲突
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
          // 纯文本文件的内容本身就是原文：补上证据链（含原文哈希），避免采集类入口被闸门强制转 review
          evidence: {
            ...(record.evidence ?? { text: content.slice(0, 500), location: filePath }),
            sourceHash: contentHash,
          },
        };
        const existing = memoryService.getMemory(stableRecord.id);
        if (existing) {
          const unchanged = existing.evidence?.sourceHash
            ? existing.evidence.sourceHash === contentHash
            : existing.content === content;
          if (unchanged) continue;
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
