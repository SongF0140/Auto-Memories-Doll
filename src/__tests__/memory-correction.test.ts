import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  generate: vi.fn(),
  degraded: false,
}));

vi.mock("../lib/ai/model-adapter", () => ({
  ModelAdapter: {
    generate: mocks.generate,
    get isDegradedMode() {
      return mocks.degraded;
    },
  },
}));

import { MemoryCorrectionService, parseRewrite, CORRECTED_TAG } from "../lib/memory/correction";
import type { MemoryRecord } from "../types/memory";

function makeMemory(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id: "m1",
    version: 1,
    source: "chat",
    sourceType: "chat",
    title: "项目名记录",
    content: "项目名是 Auto-Memories-Dol（少了一个 l）",
    summary: "项目名记录",
    tags: ["项目"],
    topic: "ai-coding",
    createdAt: "2026-08-20T00:00:00.000Z",
    updatedAt: "2026-08-20T00:00:00.000Z",
    accessedAt: "2026-08-20T00:00:00.000Z",
    accessCount: 0,
    heatScore: 0,
    graphLinks: [],
    ...overrides,
  };
}

function makeDeps(memory: MemoryRecord | null) {
  const memoryService = {
    getMemory: vi.fn().mockReturnValue(memory),
    stageUpdateMemory: vi.fn().mockReturnValue("evt-1"),
  };
  const retriever = {
    search: vi.fn().mockResolvedValue(memory ? [{ memoryId: memory.id, similarity: 0.9 }] : []),
  };
  return { memoryService, retriever };
}

describe("parseRewrite", () => {
  it("提取合法字段，忽略空值与非字符串", () => {
    const raw = '前缀 {"title": "新标题", "summary": "", "content": 42} 后缀';
    expect(parseRewrite(raw)).toEqual({ title: "新标题" });
  });

  it("非法 JSON 返回空对象", () => {
    expect(parseRewrite("没有 JSON")).toEqual({});
    expect(parseRewrite("")).toEqual({});
  });
});

describe("MemoryCorrectionService.correct", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.degraded = false;
  });

  it("按 memoryId 定位并纠错：改写经审计队列落库，打 corrected 标签", async () => {
    const memory = makeMemory();
    const { memoryService, retriever } = makeDeps(memory);
    mocks.generate.mockResolvedValue({
      content: '{"title": "项目名记录", "summary": "项目名记录", "content": "项目名是 Auto-Memories-Doll"}',
      finishReason: "stop",
      model: "budget",
      timestamp: "2026-08-23T00:00:00.000Z",
    });

    const service = new MemoryCorrectionService(memoryService, retriever);
    const result = await service.correct({
      memoryId: "m1",
      instruction: "项目名写错了，应该是 Auto-Memories-Doll",
    });

    expect(result).toMatchObject({
      success: true,
      memoryId: "m1",
      eventId: "evt-1",
    });
    expect(memoryService.stageUpdateMemory).toHaveBeenCalledWith("m1", {
      content: "项目名是 Auto-Memories-Doll",
      tags: ["项目", CORRECTED_TAG],
    });
    if (result.success) {
      expect(result.changedFields).toContain("content");
      expect(result.changedFields).toContain("tags");
    }
  });

  it("无 memoryId 时用 locateQuery 检索定位 top-1", async () => {
    const memory = makeMemory();
    const { memoryService, retriever } = makeDeps(memory);
    mocks.generate.mockResolvedValue({
      content: '{"title": "改过的标题", "summary": "项目名记录", "content": "项目名是 Auto-Memories-Doll"}',
      finishReason: "stop",
      model: "budget",
      timestamp: "2026-08-23T00:00:00.000Z",
    });

    const service = new MemoryCorrectionService(memoryService, retriever);
    const result = await service.correct({
      locateQuery: "项目名",
      instruction: "标题改一下",
    });

    expect(retriever.search).toHaveBeenCalledWith("项目名", 1);
    expect(result.success).toBe(true);
  });

  it("缺少纠错指令时直接失败", async () => {
    const { memoryService, retriever } = makeDeps(makeMemory());
    const service = new MemoryCorrectionService(memoryService, retriever);

    const result = await service.correct({ memoryId: "m1", instruction: "   " });

    expect(result).toEqual({ success: false, error: "缺少纠错指令" });
    expect(memoryService.stageUpdateMemory).not.toHaveBeenCalled();
  });

  it("定位不到记忆时返回失败", async () => {
    const { memoryService, retriever } = makeDeps(null);
    const service = new MemoryCorrectionService(memoryService, retriever);

    const byId = await service.correct({ memoryId: "nope", instruction: "改一下" });
    const byQuery = await service.correct({ locateQuery: "不存在的东西", instruction: "改一下" });

    expect(byId.success).toBe(false);
    expect(byQuery.success).toBe(false);
  });

  it("模型降级模式下拒绝纠错", async () => {
    mocks.degraded = true;
    const { memoryService, retriever } = makeDeps(makeMemory());
    const service = new MemoryCorrectionService(memoryService, retriever);

    const result = await service.correct({ memoryId: "m1", instruction: "改一下" });

    expect(result).toEqual({
      success: false,
      error: "模型当前不可用，无法执行纠错改写，请稍后重试",
    });
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("模型调用返回降级时失败", async () => {
    const { memoryService, retriever } = makeDeps(makeMemory());
    mocks.generate.mockResolvedValue({
      content: "兜底文案",
      finishReason: "degraded",
      model: "fallback",
      timestamp: "2026-08-23T00:00:00.000Z",
    });
    const service = new MemoryCorrectionService(memoryService, retriever);

    const result = await service.correct({ memoryId: "m1", instruction: "改一下" });

    expect(result.success).toBe(false);
    expect(memoryService.stageUpdateMemory).not.toHaveBeenCalled();
  });

  it("改写结果与原值完全一致时视为无有效改动", async () => {
    const memory = makeMemory();
    const { memoryService, retriever } = makeDeps(memory);
    mocks.generate.mockResolvedValue({
      content: JSON.stringify({
        title: memory.title,
        summary: memory.summary,
        content: memory.content,
      }),
      finishReason: "stop",
      model: "budget",
      timestamp: "2026-08-23T00:00:00.000Z",
    });
    const service = new MemoryCorrectionService(memoryService, retriever);

    const result = await service.correct({ memoryId: "m1", instruction: "改一下" });

    expect(result).toEqual({ success: false, error: "未产生有效改动，记忆保持不变" });
  });

  it("已有 corrected 标签时不重复追加", async () => {
    const memory = makeMemory({ tags: ["项目", CORRECTED_TAG] });
    const { memoryService, retriever } = makeDeps(memory);
    mocks.generate.mockResolvedValue({
      content: '{"title": "项目名记录", "summary": "新摘要", "content": "项目名是 Auto-Memories-Doll"}',
      finishReason: "stop",
      model: "budget",
      timestamp: "2026-08-23T00:00:00.000Z",
    });
    const service = new MemoryCorrectionService(memoryService, retriever);

    await service.correct({ memoryId: "m1", instruction: "改摘要和内容" });

    const updates = memoryService.stageUpdateMemory.mock.calls[0][1];
    expect(updates.tags).toBeUndefined();
  });

  it("模型抛异常时返回失败而不向上抛", async () => {
    const { memoryService, retriever } = makeDeps(makeMemory());
    mocks.generate.mockRejectedValue(new Error("boom"));
    const service = new MemoryCorrectionService(memoryService, retriever);

    const result = await service.correct({ memoryId: "m1", instruction: "改一下" });

    expect(result).toEqual({ success: false, error: "纠错改写失败，请稍后重试" });
  });
});
