import { describe, it, expect, beforeAll } from "vitest";
import { asSchema, type FlexibleSchema } from "ai";
import { ToolCaller } from "../lib/ai/tool-caller";
import { registerDefaultTools } from "../lib/ai/tool-registry";
import { toolSchemas } from "../lib/ai/tool-schemas";

const schemaCases = [
  {
    name: "search_memory",
    required: ["query"],
    input: { query: "测试" },
    output: { query: "测试", limit: 10 },
  },
  {
    name: "create_memory",
    required: ["title", "content"],
    input: { title: "标题", content: "正文" },
    output: { title: "标题", content: "正文", tags: [] },
  },
  {
    name: "update_memory",
    required: ["id", "updates"],
    input: { id: "m1", updates: { title: "新标题" } },
    output: { id: "m1", updates: { title: "新标题" } },
  },
  {
    name: "correct_memory",
    required: ["instruction"],
    input: { memoryId: "m1", instruction: "纠错" },
    output: { memoryId: "m1", instruction: "纠错" },
  },
  { name: "delete_memory", required: ["id"], input: { id: "m1" }, output: { id: "m1" } },
  {
    name: "query_graph",
    required: ["memoryId"],
    input: { memoryId: "m1" },
    output: { memoryId: "m1", maxDepth: 1 },
  },
] as const;

describe("ToolCaller", () => {
  beforeAll(() => {
    registerDefaultTools();
  });

  it.each(schemaCases)(
    "$name 描述可由真实 SDK 转换并保留参数校验与默认值",
    async ({ name, required, input, output }) => {
      const description = ToolCaller.getToolDescriptions().find((entry) => entry.name === name)!;
      const sdkSchema = asSchema(description.schema as FlexibleSchema);
      const jsonSchema = await sdkSchema.jsonSchema;
      expect(jsonSchema.type).toBe("object");
      expect(Object.keys(jsonSchema.properties!)).toEqual(
        Object.keys(toolSchemas[name].shape ?? {}),
      );
      expect([...(jsonSchema.required ?? [])].sort()).toEqual([...required].sort());
      expect(description.schema).toBe(toolSchemas[name]);
      expect(await sdkSchema.validate!(input)).toEqual({ success: true, value: output });
    },
  );

  it.each([
    { name: "search_memory", input: { query: "" } },
    { name: "search_memory", input: { query: "测试", limit: 21 } },
    { name: "correct_memory", input: { instruction: "纠错" } },
  ])("SDK 校验拒绝 $name 的无效参数 $input", async ({ name, input }) => {
    const description = ToolCaller.getToolDescriptions().find((entry) => entry.name === name)!;
    const sdkSchema = asSchema(description.schema as FlexibleSchema);
    expect((await sdkSchema.validate!(input)).success).toBe(false);
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
    expect(tools).toContain("correct_memory");
    expect(tools).toContain("query_graph");
  });

  it("validates correct_memory params: 需要定位信息和纠错指令", async () => {
    const noLocator = await ToolCaller.callTool({
      toolName: "correct_memory",
      arguments: { instruction: "改一下" },
    });
    expect(noLocator.success).toBe(false);
    expect(noLocator.error).toContain("参数校验失败");

    const noInstruction = await ToolCaller.callTool({
      toolName: "correct_memory",
      arguments: { memoryId: "m1", instruction: "" },
    });
    expect(noInstruction.success).toBe(false);
    expect(noInstruction.error).toContain("参数校验失败");
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
