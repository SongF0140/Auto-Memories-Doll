import { describe, it, expect, beforeAll } from "vitest";
import { ToolCaller } from "../lib/ai/tool-caller";
import { registerDefaultTools } from "../lib/ai/tool-registry";

describe("ToolCaller", () => {
  beforeAll(() => {
    registerDefaultTools();
  });

  it("validates search_memory params", async () => {
    const result = await ToolCaller.callTool({
      toolName: "search_memory",
      arguments: { query: "", limit: 5 },
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("参数校验失败");
  });

  it("returns error for unknown tool", async () => {
    const result = await ToolCaller.callTool({
      toolName: "nonexistent_tool",
      arguments: {},
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });

  it("lists available tools after registration", () => {
    const tools = ToolCaller.getAvailableTools();
    expect(tools).toContain("search_memory");
    expect(tools).toContain("create_memory");
    expect(tools).toContain("delete_memory");
    expect(tools).toContain("update_memory");
    expect(tools).toContain("query_graph");
  });

  it("validates query_graph params", async () => {
    const result = await ToolCaller.callTool({
      toolName: "query_graph",
      arguments: { memoryId: "", maxDepth: 5 },
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("参数校验失败");
  });
});
