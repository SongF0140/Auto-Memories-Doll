import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { VectorRetriever } from "../../lib/vector/retriever";
import { MemoryService } from "../services/memory-service";
import { ReflectService, ReflectDisposition } from "../services/reflect-service";
import type { MemoryRecord } from "../../types/memory";

/**
 * MCP 暴露端（优先级 #3）：把本机记忆库以只读工具集暴露给外部 agent
 * （Claude Code / Codex 等），与采集端（McpCollectScheduler）形成闭环——
 * 本机工具产生的会话被采集入库，本机 agent 反过来经 MCP 检索这批记忆。
 *
 * 红线：
 * - 纯只读：三个工具只调用读方法，绝不触碰 accessCount（仅用户主动点击递增）
 *   与 retrievalCount 等 weaken 信号；写路径只存在于 Next.js 主应用。
 * - 检索语义与主应用一致：复用 VectorRetriever.searchDetailed（I-8 自适应路由、
 *   RRF 融合、0.3 相似度阈值），overview / temporal 路由的装配与
 *   ChatHandler 对齐（轻量复刻其私有方法，避免引入 AI 流式等重依赖）。
 * - memory.db 单一真源：经 getDatabase() 打开同一 WAL 库，多进程并发读安全。
 */

export type MemoryServerDeps = {
  retriever?: Pick<VectorRetriever, "searchDetailed" | "close">;
  memoryService?: Pick<MemoryService, "getMemoriesByIds" | "listMemories" | "close">;
  reflectService?: Pick<ReflectService, "reflect" | "close">;
};

const VALID_DISPOSITIONS: ReflectDisposition[] = ["balanced", "skeptical", "literal", "empathetic"];

/** 检索结果中 content 的默认携带长度上限：摘要已浓缩语义，全文按需用 withContent / get_memory */
const CONTENT_PREVIEW_LIMIT = 300;

const MEMORY_OVERVIEW = [
  "本机个人记忆库（auto-memeries-doll）：被动采集本机 Claude Code / Codex / Cursor 等",
  "工具的会话文件，抽取为中文记忆卡片（含实体、因果边、综合卡）。此工具集为只读检索。",
].join("");

function formatCard(card: MemoryRecord, similarity?: number, withContent?: boolean) {
  const entry: Record<string, unknown> = {
    id: card.id,
    title: card.title,
    summary: card.summary,
    topic: card.topic,
    tags: card.tags,
    kind: card.kind,
    createdAt: card.createdAt,
    updatedAt: card.updatedAt,
  };
  if (similarity !== undefined) entry.similarity = Number(similarity.toFixed(4));
  if (card.windowUse) entry.windowUse = card.windowUse;
  if (card.sources?.length) entry.sources = card.sources;
  if (withContent) {
    entry.content =
      card.content.length > CONTENT_PREVIEW_LIMIT
        ? `${card.content.slice(0, CONTENT_PREVIEW_LIMIT)}…（全文用 get_memory 按 id 获取）`
        : card.content;
  }
  return entry;
}

function textResult(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
}

function errorResult(message: string) {
  return { isError: true as const, content: [{ type: "text" as const, text: message }] };
}

/**
 * overview 路由结果提供器：与 ChatHandler.searchOverview 对齐——
 * synthesis 卡优先（编译产物即知识总览），其余按 updatedAt 新者优先。
 */
async function searchOverview(
  memoryService: Pick<MemoryService, "listMemories">,
  query: string,
  limit: number,
): Promise<{ memoryId: string; similarity: number }[]> {
  const topic = knownTopics(memoryService).find((t) => query.includes(t));
  const all = memoryService.listMemories({ limit: 200, sortBy: "updatedAt" });
  const scoped = topic ? all.filter((m) => m.topic === topic) : all;

  const synthesis = scoped
    .filter((m) => m.kind === "synthesis")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, Math.min(limit, 3))
    .map((m) => ({ memoryId: m.id, similarity: 1 }));

  const recent = scoped
    .filter((m) => m.kind !== "synthesis")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, Math.max(limit - synthesis.length, 0))
    .map((m, index) => ({ memoryId: m.id, similarity: 0.9 - index * 0.01 }));

  return [...synthesis, ...recent];
}

function knownTopics(memoryService: Pick<MemoryService, "listMemories">): string[] {
  try {
    return [...new Set(memoryService.listMemories({ limit: 200 }).map((m) => m.topic))];
  } catch {
    return [];
  }
}

export function createMemoryServer(deps: MemoryServerDeps = {}): McpServer {
  const memoryService = deps.memoryService ?? new MemoryService();

  const retriever =
    deps.retriever ??
    new VectorRetriever({
      overviewProvider: (query, limit) => searchOverview(memoryService, query, limit),
      temporalMetaProvider: async (ids) =>
        memoryService.getMemoriesByIds(ids).map((m) => ({
          memoryId: m.id,
          createdAt: m.createdAt,
          text: `${m.summary}\n${m.content}`,
        })),
      topics: knownTopics(memoryService),
    });

  // Reflect 与检索共享同一 retriever / memoryService（index 缓存复用）
  const reflectService =
    deps.reflectService ??
    new ReflectService({
      retriever,
      memoryService,
    });

  const server = new McpServer(
    { name: "auto-memeries-doll", version: "1.0.0" },
    { instructions: MEMORY_OVERVIEW },
  );

  // ── 工具 1：语义检索（自适应路由：vector/keyword/hybrid/graph/overview/temporal） ──
  server.registerTool(
    "search_memory",
    {
      title: "检索本机记忆库",
      description:
        "在用户的本机记忆库中检索记忆卡片。适合回答「用户之前做过/讨论过什么」「某话题的背景与结论」。" +
        "自适应路由自动选择语义/关键词/图谱/总览/时序管线；默认只带摘要，withContent=true 附带正文预览。" +
        "只读操作，不计入任何访问统计。",
      inputSchema: {
        query: z.string().min(1).describe("检索问题，用自然语言（中文优先，与卡片语言一致）"),
        limit: z.number().int().min(1).max(50).optional().describe("返回条数，默认 10"),
        withContent: z.boolean().optional().describe("附带正文预览（前 300 字符），默认 false"),
      },
    },
    async ({ query, limit, withContent }) => {
      try {
        const response = await retriever.searchDetailed(query, limit ?? 10);
        const records = memoryService.getMemoriesByIds(response.results.map((r) => r.memoryId));
        const byId = new Map(records.map((m) => [m.id, m]));
        return textResult({
          route: response.route ?? response.mode,
          count: response.results.length,
          results: response.results
            .map((r) => {
              const card = byId.get(r.memoryId);
              return card ? formatCard(card, r.similarity, withContent) : null;
            })
            .filter(Boolean),
        });
      } catch (error) {
        return errorResult(`检索失败：${(error as Error).message}`);
      }
    },
  );

  // ── 工具 2：按 id 取卡片全文 ──
  server.registerTool(
    "get_memory",
    {
      title: "读取记忆卡片全文",
      description:
        "按 id 读取一条记忆卡片的完整内容（含正文、标签、图谱链接、取代链状态）。只读操作。",
      inputSchema: {
        id: z
          .string()
          .min(1)
          .describe("记忆卡片 id（来自 search_memory / list_recent_memories 的结果）"),
      },
    },
    async ({ id }) => {
      try {
        const [card] = memoryService.getMemoriesByIds([id]);
        if (!card) return errorResult(`未找到记忆卡片：${id}`);
        return textResult({
          ...formatCard(card, undefined, true),
          content: card.content,
          graphLinks: card.graphLinks,
          evidence: card.evidence,
          status: card.status,
          supersededBy: card.supersededBy,
          confidence: card.confidence,
        });
      } catch (error) {
        return errorResult(`读取失败：${(error as Error).message}`);
      }
    },
  );

  // ── 工具 3：最近记忆列表（按 topic/tag 过滤） ──
  server.registerTool(
    "list_recent_memories",
    {
      title: "列出最近记忆",
      description:
        "按更新时间倒序列出记忆卡片（默认排除已被取代的卡片），支持 topic / tag 过滤。" +
        "适合「最近在做什么」「某话题下有哪些记忆」类浏览式问题。只读操作。",
      inputSchema: {
        limit: z.number().int().min(1).max(100).optional().describe("返回条数，默认 20"),
        topic: z.string().optional().describe("按话题精确过滤"),
        tag: z.string().optional().describe("按标签精确过滤"),
      },
    },
    async ({ limit, topic, tag }) => {
      try {
        const cards = memoryService.listMemories({
          limit: limit ?? 20,
          sortBy: "updatedAt",
          topic,
          tag,
        });
        return textResult({ count: cards.length, results: cards.map((m) => formatCard(m)) });
      } catch (error) {
        return errorResult(`列表失败：${(error as Error).message}`);
      }
    },
  );

  // ── 工具 4：Reflect 式推理（检索 → disposition-aware 推理 → 带依据答案） ──
  server.registerTool(
    "reflect_memory",
    {
      title: "基于记忆推理",
      description:
        "先检索与问题相关的记忆卡片，再由 LLM 对这批记忆做 disposition-aware 推理，" +
        "产出带依据标注（卡: id）的答案：发现矛盾、归纳结论、检验前提。" +
        "适合「根据我的记忆，X 和 Y 哪个对」「我之前的方法有什么共性问题」类需要综合推理的问题。" +
        "只读操作，不落任何新卡。",
      inputSchema: {
        query: z.string().min(1).describe("要推理的问题"),
        disposition: z
          .enum(["balanced", "skeptical", "literal", "empathetic"])
          .optional()
          .describe(
            "推理视角：balanced 平衡（默认）/ skeptical 怀疑（审视可信度）/ literal 字面（不引申）/ empathetic 共情（关注意图与偏好）",
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(12)
          .optional()
          .describe("参与推理的记忆条数上限，默认 6"),
      },
    },
    async ({ query, disposition, limit }) => {
      try {
        const result = await reflectService.reflect(
          query,
          VALID_DISPOSITIONS.includes(disposition as ReflectDisposition)
            ? (disposition as ReflectDisposition)
            : "balanced",
          limit ?? 6,
        );
        return textResult(result);
      } catch (error) {
        return errorResult(`推理失败：${(error as Error).message}`);
      }
    },
  );

  return server;
}

/** stdio 入口：由 scripts/memory-mcp-server.mjs 启动器调用 */
export async function main(deps: MemoryServerDeps = {}): Promise<void> {
  const server = createMemoryServer(deps);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
