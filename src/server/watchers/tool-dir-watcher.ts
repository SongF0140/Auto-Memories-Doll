import { watch, FSWatcher } from "chokidar";
import { readdir } from "fs/promises";
import { statSync } from "fs";
import { isAbsolute, join, relative, resolve } from "path";
import { createHash } from "crypto";
import { ConfigService } from "../services/config-service";
import { ToolWatchSource } from "../../types/config";
import { parseSession } from "../../lib/tools/session-parser";
import { MemoryService } from "../services/memory-service";
import { isRecentWrite } from "../../lib/storage/write-tracker";
import { logger } from "../../lib/logger";
import { buildKnowledgeLogFromText } from "../../features/ingest/knowledge-log";
import { getMemoryRoot } from "../../lib/storage/path-resolver";

/**
 * 本地工具工作目录监听器。
 *
 * 管理多个监听源（Cursor/Codex/Claude Code 等），每个源对应一个 chokidar watcher。
 * 文件新增/变化时：
 * 1. 跳过本进程写入的文件（防循环）
 * 2. 防抖：文件静默 DEBOUNCE_QUIET_MS 后才解析入队（会话文件边写边读会采到半截）
 * 3. 调用 parseSession 按工具类型解析，超长会话截断
 * 4. 按「来源+路径」生成稳定 ID，内容未变更直接跳过，变更走更新事件
 *
 * 运行状态存 globalThis：Next.js dev 把 instrumentation 与路由编译成独立模块实例，
 * 模块级单例不共享，跨 bundle 查询状态（如 GET /api/listen）必须走 globalThis。
 */

/** 防抖静默窗口：文件最后一次变更后静默如此之久才采集 */
const DEBOUNCE_QUIET_MS = 90_000;
/** 会话内容入库上限：超大会话全文 embedding+LLM 闸门耗时数分钟，会拖死队列 */
const SESSION_CONTENT_MAX_CHARS = 10_000;

interface WatcherEntry {
  source: ToolWatchSource;
  watcher: FSWatcher;
}

const globalStore = globalThis as typeof globalThis & {
  __amdToolDirEntries?: WatcherEntry[];
  __amdToolDirStarted?: boolean;
};
const entries: WatcherEntry[] = (globalStore.__amdToolDirEntries ??= []);

/** 防抖定时器：`${sourceId}:${filePath}` → timer */
const pendingTimers = new Map<string, NodeJS.Timeout>();

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

/** 来源文件 → 稳定记忆 ID：同一会话文件永远落到同一 memoryId，重启重扫不会重复建卡 */
function getStableSessionMemoryId(sourceId: string, filePath: string): string {
  const resolvedPath = filePath.replace(/\\/g, "/").toLowerCase();
  return `tool-${createHash("sha256").update(`${sourceId}:${resolvedPath}`).digest("hex").slice(0, 32)}`;
}

/** 来源原文的 sha256：入库内容是中文重写卡，靠此哈希判断来源文件是否变更 */
function sourceHashOf(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * 启动所有已启用的工具监听源。
 * 在 instrumentation.ts 中调用。
 */
export async function startToolDirWatcher(): Promise<void> {
  // 热重载防护：watcher 实例在旧模块里活着时（globalThis 标记 + entries 非空）跳过，
  // 避免同进程对同一目录开两个监听
  if (entries.length > 0 || globalStore.__amdToolDirStarted) return;

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

  globalStore.__amdToolDirStarted = true;
  for (const source of sources) {
    await startSingleSource(source);
  }

  logger.ingest.info(`[ToolDirWatcher] 已启动 ${entries.length} 个监听源`);
}

async function startSingleSource(source: ToolWatchSource): Promise<void> {
  try {
    // 展开 ~ 为用户主目录（chokidar/fs 在 Windows 上不识别 ~ 前缀）。
    // 直接读取环境变量，避免 Next.js 文件追踪器在构建时递归扫描整个用户目录。
    let watchPath = source.path;
    if (source.path.startsWith("~")) {
      const homeDir = process.env.USERPROFILE || process.env.HOME;
      if (!homeDir) throw new Error(`无法展开监听路径: ${source.path}`);
      watchPath = join(homeDir, source.path.slice(1));
    }
    if (isMemoryRootPath(watchPath)) {
      logger.ingest.warn(`[ToolDirWatcher] 跳过应用自身记忆目录: ${watchPath}`);
      return;
    }
    const pattern = source.filePattern || "*.jsonl";
    const watcher = watch(watchPath, {
      ignored: ["**/node_modules/**", "**/.git/**"],
      persistent: true,
      ignoreInitial: false, // 启动时扫描已有文件（首次导入历史会话）
      awaitWriteFinish: { stabilityThreshold: 1000, pollInterval: 300 },
      depth: 5,
    });

    // 把 glob 模式转换为 chokidar 的忽略策略
    // 简化处理：直接监听所有文件，在 handler 里按扩展名过滤
    const allowedExts = patternToExtensions(pattern);

    // 防抖调度：add/change 只重置定时器，静默 DEBOUNCE_QUIET_MS 后才真正解析入队。
    // 会话文件在活跃对话期间每秒都在追加，立即采集会反复解析半截内容。
    const schedule = (filePath: string) => {
      const timerKey = `${source.id}:${filePath}`;
      const existing = pendingTimers.get(timerKey);
      if (existing) clearTimeout(existing);
      pendingTimers.set(
        timerKey,
        setTimeout(() => {
          pendingTimers.delete(timerKey);
          void handleFileEvent(filePath, source, allowedExts);
        }, DEBOUNCE_QUIET_MS),
      );
    };

    watcher.on("add", (filePath) => schedule(filePath));
    watcher.on("change", (filePath) => schedule(filePath));

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

function isMemoryRootPath(candidatePath: string): boolean {
  const root = resolve(getMemoryRoot());
  const candidate = resolve(candidatePath);
  const relativePath = relative(root, candidate);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
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

    // 超长会话头部截断：尾部追加不影响头部，稳定 ID + 内容跳过逻辑仍然有效
    const content = limitSessionContent(session.content);
    const knowledgeLog = buildKnowledgeLogFromText(content, {
      source: source.name,
    });
    const hash = sourceHashOf(content);

    const memoryService = new MemoryService();
    try {
      const stableId = getStableSessionMemoryId(source.id, filePath);
      const existing = memoryService.getMemory(stableId);

      if (existing) {
        // 抽取型记忆：入库内容是中文重写卡，与原文不可字面比对，靠 sourceHash 判断变更
        if (existing.evidence?.sourceHash) {
          if (existing.evidence.sourceHash === hash) return; // 原文未变更，跳过
        } else if (existing.content === content) {
          return; // 旧的原文型记忆且内容未变
        }
        // 内容有变更：清掉队列中同内容的未完成事件后走更新事件（触发分卡重建）
        if (memoryService.hasEquivalentPendingEvent(stableId, knowledgeLog.content)) return;
        memoryService.stageUpdateMemory(stableId, {
          content: knowledgeLog.content,
          summary: knowledgeLog.summary,
          evidence: {
            text: content.slice(0, 500),
            location: filePath,
            sourceHash: hash,
          },
        });
        logger.ingest.info(`[ToolDirWatcher] 会话已更新，重新入队`, {
          source: source.name,
          memoryId: stableId,
        });
        return;
      }

      // 新文件：队列里已有同内容事件（重启重扫、旧事件仍在积压）→ 跳过
      if (memoryService.hasEquivalentPendingEvent(stableId, knowledgeLog.content)) return;

      memoryService.stageCreateMemory(
        `${source.name}:${filePath}`,
        "ingest",
        session.title,
        knowledgeLog.content,
        knowledgeLog.summary,
        tags,
        topic,
        undefined,
        stableId,
        // 采集入口必须带证据链：原文片段 + 文件位置 + 原文哈希，供闸门校验与变更检测
        { evidence: { text: content.slice(0, 500), location: filePath, sourceHash: hash } },
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

function limitSessionContent(content: string): string {
  if (content.length <= SESSION_CONTENT_MAX_CHARS) return content;
  const tailLength = 2_500;
  const headLength = SESSION_CONTENT_MAX_CHARS - tailLength;
  return `${content.slice(0, headLength)}\n\n<!-- 中间内容已截断，原文 ${content.length} 字符 -->\n\n${content.slice(-tailLength)}`;
}

/**
 * 立即重扫所有监听源目录（绕过防抖），供「扫描」按钮调用。
 * 已入库且未变更的文件会被内容跳过，不产生 LLM 成本。返回扫描的文件数。
 */
export async function scanToolSources(): Promise<number> {
  // 扫描 = 强制复查：清掉 mtime 签名缓存，否则同一进程内的第二次扫描会被缓存直接跳过。
  // 内容级跳过（sourceHash/内容比对）仍在 handleFileEvent 内生效，未变更文件不会重复入队。
  processedFiles.clear();
  let scanned = 0;
  for (const entry of [...entries]) {
    let watchPath = entry.source.path;
    if (watchPath.startsWith("~")) {
      const homeDir = process.env.USERPROFILE || process.env.HOME;
      if (!homeDir) continue;
      watchPath = join(homeDir, watchPath.slice(1));
    }
    const allowedExts = patternToExtensions(entry.source.filePattern || "*.jsonl");
    try {
      const all = await readdir(watchPath, { recursive: true });
      for (const rel of all) {
        const normalized = rel.replace(/\\/g, "/");
        const ext = normalized.slice(normalized.lastIndexOf("."));
        if (!allowedExts.includes(ext)) continue;
        // 防抖绕过：扫描要求立即采集，直接走处理函数（内部仍有内容级跳过）
        await handleFileEvent(join(watchPath, rel), entry.source, allowedExts);
        scanned++;
      }
    } catch (error) {
      logger.ingest.error(`[ToolDirWatcher] 扫描监听源 "${entry.source.name}" 失败:`, {
        error: (error as Error).message,
      });
    }
  }
  return scanned;
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
  for (const timer of pendingTimers.values()) clearTimeout(timer);
  pendingTimers.clear();
  for (const entry of entries) {
    try {
      entry.watcher.close();
    } catch {
      // ignore
    }
  }
  entries.length = 0;
  globalStore.__amdToolDirStarted = false;
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
