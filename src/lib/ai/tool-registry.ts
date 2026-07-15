import { ToolCaller } from "./tool-caller";

export const registerDefaultTools = (): void => {
  ToolCaller.registerTool("search_memory", async (args: Record<string, any>) => {
    const query = String(args.query || "");
    const limit = Number(args.limit) || 10;
    return { query, limit, results: [] as any[] };
  });

  ToolCaller.registerTool("create_memory", async (args: Record<string, any>) => {
    const title = String(args.title || "");
    const content = String(args.content || "");
    const tags = Array.isArray(args.tags) ? args.tags : [];
    return { success: true, title, content, tags };
  });

  ToolCaller.registerTool("update_memory", async (args: Record<string, any>) => {
    const id = String(args.id || "");
    const updates = args.updates as Record<string, any> || {};
    return { success: true, id, updates };
  });

  ToolCaller.registerTool("delete_memory", async (args: Record<string, any>) => {
    const id = String(args.id || "");
    return { success: true, id };
  });
};
