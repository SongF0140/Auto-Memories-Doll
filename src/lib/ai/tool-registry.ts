import { ToolCaller } from "./tool-caller";
import { MemoryService } from "../../server/services/memory-service";
import { VectorRetriever } from "../../lib/vector/retriever";
import { WikiGraph } from "../graph/wiki-graph";
import { MemoryCorrectionService } from "../memory/correction";
import { buildPendingEvent } from "../memory/builder";
import { generateId } from "../utils/id";

export const registerDefaultTools = (): void => {
  ToolCaller.registerTool(
    "search_memory",
    async (args) => {
      const { query, limit } = args as { query: string; limit: number };
      const service = new MemoryService();
      try {
        const all = service.listMemories({ limit: 200 });
        const results = all
          .filter(
            (m) =>
              m.title.includes(query) ||
              m.summary.includes(query) ||
              m.tags.some((t) => t.includes(query)),
          )
          .slice(0, limit)
          .map((m) => ({
            id: m.id,
            title: m.title,
            summary: m.summary,
            tags: m.tags,
          }));
        return { query, limit, total: results.length, results };
      } finally {
        service.close();
      }
    },
    "在记忆中搜索匹配指定关键词的内容，返回匹配的记忆列表",
  );

  ToolCaller.registerTool(
    "create_memory",
    async (args) => {
      const { title, content, tags, summary } = args as {
        title: string;
        content: string;
        tags: string[];
        summary?: string;
      };
      const service = new MemoryService();
      try {
        const id = generateId();
        const now = new Date().toISOString();
        const candidate = {
          id,
          version: 1,
          source: "tool",
          sourceType: "manual" as const,
          title,
          content,
          summary: summary || "",
          tags,
          topic: "uncategorized",
          createdAt: now,
          updatedAt: now,
          accessedAt: now,
          accessCount: 0,
          heatScore: 0,
          graphLinks: [],
        };
        const event = buildPendingEvent(id, "manual", candidate, [
          "title",
          "content",
          "summary",
          "tags",
        ]);
        service.enqueueEvent(event);
        return {
          success: true,
          id,
          title,
          content: `记忆 "${title}" 已创建（ID: ${id}），等待审计处理。`,
          data: { memoryId: id, status: "pending_audit" },
        };
      } finally {
        service.close();
      }
    },
    "创建一条新的记忆记录，保存标题、内容和标签",
  );

  ToolCaller.registerTool(
    "update_memory",
    async (args) => {
      const { id, updates } = args as {
        id: string;
        updates: Record<string, unknown>;
      };
      const service = new MemoryService();
      try {
        const existing = service.getMemory(id);
        if (!existing) {
          return { success: false, error: "Memory not found", id };
        }
        const candidate = {
          ...existing,
          ...updates,
          updatedAt: new Date().toISOString(),
        } as typeof existing;
        const changedFields = Object.keys(updates);
        const event = buildPendingEvent(id, "manual", candidate, changedFields);
        service.enqueueEvent(event);
        return {
          success: true,
          id,
          content: `记忆 "${existing.title}" 更新已入队，等待审计处理。`,
          data: { memoryId: id, status: "pending_audit" },
        };
      } finally {
        service.close();
      }
    },
    "更新已有记忆的部分字段，需提供记忆 ID 和要更新的字段",
  );

  ToolCaller.registerTool(
    "correct_memory",
    async (args) => {
      const { memoryId, locateQuery, instruction } = args as {
        memoryId?: string;
        locateQuery?: string;
        instruction: string;
      };
      const service = new MemoryService();
      const retriever = new VectorRetriever();
      try {
        const correction = new MemoryCorrectionService(service, retriever);
        const result = await correction.correct({ memoryId, locateQuery, instruction });
        if (!result.success) {
          return { success: false, error: result.error };
        }
        return {
          success: true,
          id: result.memoryId,
          title: result.title,
          content: `记忆 "${result.title}" 纠错已入队（改动字段: ${result.changedFields.join(", ")}），等待审计处理。`,
          data: {
            memoryId: result.memoryId,
            eventId: result.eventId,
            changedFields: result.changedFields,
            status: "pending_audit",
          },
        };
      } finally {
        retriever.close();
        service.close();
      }
    },
    "纠正一条记忆中的错误信息。通过记忆 ID 或描述定位目标，按纠错指令改写标题/摘要/内容，变更经审计队列落库",
  );

  ToolCaller.registerTool(
    "delete_memory",
    async (args) => {
      const { id } = args as { id: string };
      const service = new MemoryService();
      try {
        const existing = service.getMemory(id);
        if (!existing) {
          return { success: false, error: "Memory not found", id };
        }
        service.stageDeleteMemory(id);
        return {
          success: true,
          id,
          title: existing.title,
          content: `记忆 "${existing.title}" 删除请求已入队，等待审计处理。`,
          data: { memoryId: id, status: "pending_audit" },
        };
      } finally {
        service.close();
      }
    },
    "删除指定 ID 的记忆记录（标记删除，经审计队列处理后执行）",
  );

  ToolCaller.registerTool(
    "query_graph",
    async (args) => {
      const { memoryId, maxDepth } = args as { memoryId: string; maxDepth: number };
      const wikiGraph = new WikiGraph();
      const service = new MemoryService();
      try {
        const visited = new Set<string>();
        const queue: Array<{ id: string; depth: number }> = [{ id: memoryId, depth: 0 }];
        const neighbors: Array<{ id: string; title: string; depth: number }> = [];

        while (queue.length > 0) {
          const current = queue.shift()!;
          if (visited.has(current.id) || current.depth > maxDepth) continue;
          visited.add(current.id);

          if (current.id !== memoryId) {
            const mem = service.getMemory(current.id);
            neighbors.push({
              id: current.id,
              title: mem?.title || "(已删除)",
              depth: current.depth,
            });
          }

          if (current.depth < maxDepth) {
            for (const neighborId of await wikiGraph.getNeighbors(current.id)) {
              queue.push({ id: neighborId, depth: current.depth + 1 });
            }
          }
        }

        return { memoryId, maxDepth, neighbors };
      } finally {
        service.close();
      }
    },
    "查询指定记忆在图谱中的关联记忆，支持指定最大查询深度",
  );
};
