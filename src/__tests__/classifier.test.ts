import { describe, it, expect, beforeEach, vi } from "vitest";

// ── mock ModelAdapter（Layer 3 实体提取使用 generate） ──
const { mockGenerate } = vi.hoisted(() => ({
  mockGenerate: {
    content: '{"title":"测试标题","content":"测试内容","tags":["test"],"topic":"ai"}',
    shouldFail: false,
  },
}));

vi.mock("../lib/ai/model-adapter", () => ({
  ModelAdapter: {
    generateEmbedding: vi.fn(),
    generate: async (_prompt: string, _modelType: string) => {
      if (mockGenerate.shouldFail) {
        throw new Error("mock budget failure");
      }
      return {
        content: mockGenerate.content,
        model: "gpt-4o-mini",
        timestamp: "2026-01-01",
        finishReason: "stop",
      };
    },
    generateStream: vi.fn(),
    isDegradedMode: false,
  },
}));

import { ChatClassifier } from "../features/chat/classifier";

beforeEach(() => {
  mockGenerate.shouldFail = false;
  mockGenerate.content = '{"title":"测试标题","content":"测试内容","tags":["test"],"topic":"ai"}';
});

// ── 显式命令分类（第九块契约：明确操作只能来自整条斜杠命令或 UI 结构化 action） ──

describe("ChatClassifier — 显式命令分类", () => {
  it("/ 开头识别为 system_command", () => {
    const c = new ChatClassifier();
    const r = c.classify("/delete mem-1");
    expect(r.type).toBe("system_command");
    expect(r.confidence).toBeGreaterThanOrEqual(0.95);
  });

  it("含删除字样的自然语言不触发操作意图，回退 chat", () => {
    const c = new ChatClassifier();
    const r = c.classify("今天学习了删除文件的命令 rm -rf");
    expect(r.type).toBe("chat");
  });

  it("含记录字样的自然语言不触发创建意图，回退 chat", () => {
    const c = new ChatClassifier();
    const r = c.classify("记录功能怎么用？");
    expect(r.type).toBe("chat");
  });

  it("含更新/查询字样的自然语言一律回退 chat", () => {
    const c = new ChatClassifier();
    expect(c.classify("帮我更新一下对这个框架的理解").type).toBe("chat");
    expect(c.classify("搜索一下相关资料").type).toBe("chat");
    expect(c.classify("改一下这段提示词").type).toBe("chat");
  });

  it("classifyAsync 与 classify 行为一致（不再有语义回退猜测）", async () => {
    const c = new ChatClassifier();
    const r = await c.classifyAsync("今天学习了删除文件的命令");
    expect(r.type).toBe("chat");
  });
});

// ── Layer 3: budget LLM 实体提取（显式命令创建时复用） ──

describe("ChatClassifier — 实体提取", () => {
  it("提取记忆结构化字段", async () => {
    const c = new ChatClassifier();
    const e = await c.extractMemoryEntity("记住 Vue 的 watchEffect");
    expect(e).toEqual({
      title: "测试标题",
      content: "测试内容",
      tags: ["test"],
      topic: "ai",
    });
  });

  it("budget LLM 失败返回 null", async () => {
    mockGenerate.shouldFail = true;
    const c = new ChatClassifier();
    expect(await c.extractMemoryEntity("记住一些东西")).toBeNull();
  });

  it("空内容返回 null", async () => {
    mockGenerate.content = '{"title":"","content":"","tags":[],"topic":""}';
    const c = new ChatClassifier();
    expect(await c.extractMemoryEntity("无内容")).toBeNull();
  });

  it("清理 markdown 代码块包裹的 JSON", async () => {
    mockGenerate.content = '```json\n{"title":"t","content":"c","tags":[],"topic":"ai"}\n```';
    const c = new ChatClassifier();
    const e = await c.extractMemoryEntity("记住");
    expect(e).not.toBeNull();
    expect(e!.title).toBe("t");
  });

  it("非法 JSON 返回 null", async () => {
    mockGenerate.content = "not json at all";
    const c = new ChatClassifier();
    expect(await c.extractMemoryEntity("记住")).toBeNull();
  });
});
