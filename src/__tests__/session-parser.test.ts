import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { parseSession } from "../lib/tools/session-parser";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function writeTempFile(name: string, content: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "session-parser-"));
  tempDirs.push(dir);
  const filePath = join(dir, name);
  await writeFile(filePath, content, "utf-8");
  return filePath;
}

describe("parseSession toolType=trae", () => {
  it("renders structured summaries as Chinese markdown", async () => {
    const filePath = await writeTempFile(
      "session_memory_2026-08-02.jsonl",
      [
        JSON.stringify({
          intent: "公正评价一下这个项目",
          actions: ["通读 AGENTS.md", "运行 vitest"],
          outcome: "给出评价",
          learned: ["测试覆盖率较高"],
          message_summary_time: "2026-08-02 18:37:29",
        }),
        "not-json-line",
        JSON.stringify({ intent: "" }),
        JSON.stringify({
          intent: "配置工具监听自动采集会话",
          actions: [],
          learned: [],
        }),
      ].join("\n"),
    );

    const parsed = await parseSession(filePath, "trae");

    expect(parsed).not.toBeNull();
    expect(parsed?.source).toBe("trae");
    expect(parsed?.title).toBe("公正评价一下这个项目");
    expect(parsed?.messageCount).toBe(2);
    expect(parsed?.content).toContain("### 意图");
    expect(parsed?.content).toContain("**动作**：通读 AGENTS.md；运行 vitest");
    expect(parsed?.content).toContain("**结果**：给出评价");
    expect(parsed?.content).toContain("**经验**：测试覆盖率较高");
    expect(parsed?.content).toContain("**时间**：2026-08-02 18:37:29");
    expect(parsed?.content).toContain("配置工具监听自动采集会话");
  });

  it("falls back to file name when no line has intent", async () => {
    const filePath = await writeTempFile("empty.jsonl", "not-json\n");
    const parsed = await parseSession(filePath, "trae");

    expect(parsed?.title).toBe("empty");
    expect(parsed?.messageCount).toBe(0);
  });
});

describe("parseSession toolType=claude-code（元数据与工具块过滤）", () => {
  it("过滤 isMeta/summary/snapshot/system 行与 tool_result 块，只留真实对话", async () => {
    const filePath = await writeTempFile(
      "session-abc.jsonl",
      [
        // 会话摘要元数据行
        JSON.stringify({ type: "summary", summary: "向量检索回归问题速记", leafUuid: "u1" }),
        // 文件快照元数据行
        JSON.stringify({ type: "file-history-snapshot", snapshot: {} }),
        // 自动注入的 meta user 行（slash 命令展开），非真实用户输入
        JSON.stringify({
          type: "user",
          isMeta: true,
          message: {
            role: "user",
            content: [{ type: "text", text: "<command-name>/clear</command-name>" }],
          },
        }),
        // 真实用户消息
        JSON.stringify({
          type: "user",
          message: { role: "user", content: [{ type: "text", text: "帮我修复向量检索的回归" }] },
        }),
        // user 行内混工具输出回灌（tool_result）+ 文本
        JSON.stringify({
          type: "user",
          message: {
            role: "user",
            content: [
              { type: "tool_result", content: "vitest: 588 tests passed" },
              { type: "text", text: "测试全绿了" },
            ],
          },
        }),
        // assistant 文本 + 工具调用块（tool_use 不该出现在对话内容里）
        JSON.stringify({
          type: "assistant",
          message: {
            role: "assistant",
            content: [
              { type: "tool_use", name: "Read", input: { file_path: "a.ts" } },
              { type: "text", text: "问题出在临时表缺少索引" },
            ],
          },
        }),
      ].join("\n"),
    );

    const parsed = await parseSession(filePath, "claude-code");

    expect(parsed?.source).toBe("claude-code");
    expect(parsed?.messageCount).toBe(3);
    expect(parsed?.title).toContain("帮我修复向量检索的回归");
    expect(parsed?.content).toContain("帮我修复向量检索的回归");
    expect(parsed?.content).toContain("测试全绿了");
    expect(parsed?.content).toContain("问题出在临时表缺少索引");
    // 噪声不应出现
    expect(parsed?.content).not.toContain("command-name");
    expect(parsed?.content).not.toContain("vitest: 588");
    expect(parsed?.content).not.toContain("file-history-snapshot");
    expect(parsed?.content).not.toContain("向量检索回归问题速记"); // summary 行的摘要文本
    expect(parsed?.content).not.toContain("Read");
  });

  it("全部是元数据行时产出空会话（调用方按 messageCount=0 跳过）", async () => {
    const filePath = await writeTempFile(
      "meta-only.jsonl",
      [
        JSON.stringify({ type: "summary", summary: "x" }),
        JSON.stringify({ type: "file-history-snapshot" }),
      ].join("\n"),
    );

    const parsed = await parseSession(filePath, "claude-code");
    expect(parsed?.messageCount).toBe(0);
  });
});

describe("parseSession toolType=codex（rollout 格式过滤与去重）", () => {
  it("跳过 session_meta/turn_context/工具块/思考块，归一化 event_msg 角色，重复消息去重", async () => {
    const filePath = await writeTempFile(
      "rollout-2026-09-15T09-00-00-abc.jsonl",
      [
        // 系统提示（20KB+），必须整行跳过
        JSON.stringify({
          timestamp: "t0",
          type: "session_meta",
          payload: { originator: "codex_tui", instructions: "你是 Codex……" },
        }),
        // 每轮快照
        JSON.stringify({ timestamp: "t1", type: "turn_context", payload: { cwd: "/repo" } }),
        // 用户消息（event_msg 形式）
        JSON.stringify({
          timestamp: "t2",
          type: "event_msg",
          payload: { type: "user_message", message: "帮我梳理检索管线的测试缺口", kind: "plain" },
        }),
        // 工具调用与输出：不是对话
        JSON.stringify({
          timestamp: "t3",
          type: "response_item",
          payload: { type: "function_call", name: "shell", arguments: "{}" },
        }),
        JSON.stringify({
          timestamp: "t4",
          type: "response_item",
          payload: { type: "function_call_output", output: "OK" },
        }),
        // AI 思考块：不是对话
        JSON.stringify({
          timestamp: "t5",
          type: "response_item",
          payload: { type: "reasoning", summary: [] },
        }),
        // AI 回复（response_item 形式）
        JSON.stringify({
          timestamp: "t6",
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "缺口在时序路由与回填链路" }],
          },
        }),
        // 同一条用户消息再次以 response_item 形式记录：去重
        JSON.stringify({
          timestamp: "t7",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "帮我梳理检索管线的测试缺口" }],
          },
        }),
      ].join("\n"),
    );

    const parsed = await parseSession(filePath, "codex");

    expect(parsed?.source).toBe("codex");
    expect(parsed?.messageCount).toBe(2);
    expect(parsed?.title).toContain("帮我梳理检索管线的测试缺口");
    expect(parsed?.content).toContain("帮我梳理检索管线的测试缺口");
    expect(parsed?.content).toContain("缺口在时序路由与回填链路");
    // 噪声不应出现
    expect(parsed?.content).not.toContain("你是 Codex");
    expect(parsed?.content).not.toContain("shell");
    expect(parsed?.content).not.toContain("OK");
    // 去重：用户消息只出现一次
    expect(parsed?.content.match(/帮我梳理检索管线的测试缺口/g)).toHaveLength(1);
  });
});

describe("parseSession toolType=cursor（agent transcript jsonl 兜底）", () => {
  it("整体 JSON 失败时逐行解析事件，过滤工具块", async () => {
    const filePath = await writeTempFile(
      "session-xyz.jsonl",
      [
        JSON.stringify({
          type: "user",
          message: {
            role: "user",
            content: [
              { type: "tool_result", content: "3 files changed" },
              { type: "text", text: "把登录页改成深色主题" },
            ],
          },
        }),
        JSON.stringify({
          type: "assistant",
          message: {
            role: "assistant",
            content: [
              { type: "tool_use", name: "Edit", input: {} },
              { type: "text", text: "已切换主题变量" },
            ],
          },
        }),
      ].join("\n"),
    );

    const parsed = await parseSession(filePath, "cursor");

    expect(parsed?.source).toBe("cursor");
    expect(parsed?.messageCount).toBe(2);
    expect(parsed?.content).toContain("把登录页改成深色主题");
    expect(parsed?.content).toContain("已切换主题变量");
    expect(parsed?.content).not.toContain("3 files changed");
    expect(parsed?.content).not.toContain("Edit");
  });

  it("仍支持 JSON 数组与 messages 字段格式", async () => {
    const filePath = await writeTempFile(
      "chat.json",
      JSON.stringify([
        { role: "user", content: "总结一下昨天的会议" },
        { role: "assistant", content: "会议定了三件事" },
      ]),
    );

    const parsed = await parseSession(filePath, "cursor");
    expect(parsed?.messageCount).toBe(2);
    expect(parsed?.content).toContain("总结一下昨天的会议");
  });
});
