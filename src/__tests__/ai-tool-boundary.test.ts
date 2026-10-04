import { describe, expect, it } from "vitest";
import { asSchema, tool } from "ai";
import { z } from "zod";
import { toSdkInputSchema, toSdkTool } from "../lib/ai/openai-provider";
import type { AiToolDef } from "../lib/ai/ai-events";

/** 复刻 SDK prepare-tools 的真实 schema 转换路径 */
async function resolveJsonSchema(schema: unknown) {
  const sdkTool = tool({ description: "d", inputSchema: schema } as never) as {
    inputSchema: unknown;
  };
  return asSchema(sdkTool.inputSchema as never).jsonSchema;
}

describe("AI tool boundary", () => {
  it("普通 JSON Schema 对象无法通过真实 SDK 转换（MCP 现状回归）", async () => {
    const plain = {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    };
    await expect(async () => {
      await resolveJsonSchema(plain);
    }).rejects.toThrow();
  });

  it("toSdkInputSchema 用 SDK jsonSchema 包装普通对象并可通过真实转换", async () => {
    const plain = {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    };
    const resolved = await resolveJsonSchema(toSdkInputSchema(plain));
    expect(resolved).toMatchObject({
      type: "object",
      properties: { query: { type: "string" } },
    });
  });

  it("toSdkInputSchema 对 Zod schema 原样传递（保持第五块契约）", () => {
    const schema = z.object({ query: z.string() });
    expect(toSdkInputSchema(schema)).toBe(schema);
  });

  it("toSdkTool 将成功信封映射为模型文本", async () => {
    const def: AiToolDef = {
      name: "t",
      description: "d",
      parameters: z.object({}),
      execute: async () => ({ success: true, content: "知识已保存", data: { id: "m1" } }),
    };
    const sdkTool = toSdkTool(def);
    const modelOutput = await sdkTool.toModelOutput({
      toolCallId: "c1",
      input: {},
      output: { success: true, content: "知识已保存", data: { id: "m1" } },
    });
    expect(modelOutput).toEqual({ type: "text", value: "知识已保存" });
  });

  it("toSdkTool 将业务失败映射为 error-text 并保留错误信息", async () => {
    const def: AiToolDef = {
      name: "t",
      description: "d",
      parameters: z.object({}),
      execute: async () => ({ success: false, content: "", error: "记忆不存在" }),
    };
    const sdkTool = toSdkTool(def);
    const modelOutput = await sdkTool.toModelOutput({
      toolCallId: "c1",
      input: {},
      output: { success: false, content: "", error: "记忆不存在" },
    });
    expect(modelOutput).toEqual({ type: "error-text", value: "记忆不存在" });
  });

  it("toSdkTool 对非信封输出保持默认映射：字符串转文本、对象转 JSON", async () => {
    const def: AiToolDef = {
      name: "t",
      description: "d",
      parameters: z.object({}),
      execute: async () => "plain",
    };
    const sdkTool = toSdkTool(def);
    expect(await sdkTool.toModelOutput({ toolCallId: "c1", input: {}, output: "plain" })).toEqual({
      type: "text",
      value: "plain",
    });
    expect(await sdkTool.toModelOutput({ toolCallId: "c1", input: {}, output: { a: 1 } })).toEqual({
      type: "json",
      value: { a: 1 },
    });
  });
});
