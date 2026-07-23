import { ToolCaller } from "./tool-caller";
import { MemoryService } from "../../server/services/memory-service";

export const registerDefaultTools = (): void => {
  ToolCaller.registerTool("search_memory", async (args: Record<string, any>) => {
    const service = new MemoryService();
    try {
      const query = String(args.query || "");
      const limit = Number(args.limit) || 10;
      const all = service.listMemories();
      // 简单的关键词匹配搜索
      const results = all
        .filter(
          m =>
            m.title.includes(query) ||
            m.summary.includes(query) ||
            m.tags.some(t => t.includes(query))
        )
        .slice(0, limit)
        .map(m => ({
          id: m.id,
          title: m.title,
          summary: m.summary,
          tags: m.tags,
        }));
      return { query, limit, results };
    } finally {
      service.close();
    }
  });

  ToolCaller.registerTool("create_memory", async (args: Record<string, any>) => {
    const service = new MemoryService();
    try {
      const title = String(args.title || "");
      const content = String(args.content || "");
      const tags = Array.isArray(args.tags) ? args.tags : [];
      const id = await service.createMemory("tool", "manual", title, content, "", tags);
      return { success: true, id, title };
    } finally {
      service.close();
    }
  });

  ToolCaller.registerTool("update_memory", async (args: Record<string, any>) => {
    const service = new MemoryService();
    try {
      const id = String(args.id || "");
      const updates = args.updates as Record<string, any> || {};
      const existing = service.getMemory(id);
      if (!existing) {
        return { success: false, error: "Memory not found", id };
      }
      service.updateMemory(id, { ...existing, ...updates });
      return { success: true, id };
    } finally {
      service.close();
    }
  });

  ToolCaller.registerTool("delete_memory", async (args: Record<string, any>) => {
    const service = new MemoryService();
    try {
      const id = String(args.id || "");
      const existing = service.getMemory(id);
      if (!existing) {
        return { success: false, error: "Memory not found", id };
      }
      service.deleteMemory(id);
      return { success: true, id };
    } finally {
      service.close();
    }
  });
};
