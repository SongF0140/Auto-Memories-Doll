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

import {
  MemoryCorrectionService,
  parseRewrite,
  isAppendLikeRewrite,
  CORRECTED_TAG,
} from "../lib/memory/correction";
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

describe("isAppendLikeRewrite 硬校验", () => {
  it("原文是改写结果的严格前缀 → 判定追加式", () => {
    expect(isAppendLikeRewrite("A。B。", "A。B。C。补充内容")).toBe(true);
  });

  it("空白差异归一化后仍判定追加式", () => {
    expect(isAppendLikeRewrite("A。 B。", "A。B。\n\n新加的一段")).toBe(true);
  });

  it("完全未改动不算追加", () => {
    expect(isAppendLikeRewrite("A。B。", "A。B。")).toBe(false);
  });

  it("开头被重组的融合式改写不误判", () => {
    expect(isAppendLikeRewrite("A。B。", "A2。B 融合了新点。C。")).toBe(false);
  });

  it("空串不判定", () => {
    expect(isAppendLikeRewrite("", "A")).toBe(false);
    expect(isAppendLikeRewrite("A", "")).toBe(false);
  });
});

describe("MemoryCorrectionService.correct 追加式硬校验", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.degraded = false;
  });

  const appendLike = (extra: string) =>
    JSON.stringify({
      title: "项目名记录",
      summary: "项目名记录",
      content: `项目名是 Auto-Memories-Dol（少了一个 l）\n\n${extra}`,
    });

  const fused = JSON.stringify({
    title: "项目名记录",
    summary: "项目名记录",
    content: "项目名是 Auto-Memories-Doll，仓库在 GitHub 开源",
  });

  const llm = (content: string) => ({
    content,
    finishReason: "stop",
    model: "budget",
    timestamp: "2026-08-23T00:00:00.000Z",
  });

  it("第一次输出追加式 → 带反馈重试 → 融合式通过", async () => {
    const memory = makeMemory();
    const { memoryService, retriever } = makeDeps(memory);
    mocks.generate
      .mockResolvedValueOnce(llm(appendLike("仓库在 GitHub 开源")))
      .mockResolvedValueOnce(llm(fused));

    const service = new MemoryCorrectionService(memoryService, retriever);
    const result = await service.correct({
      memoryId: "m1",
      instruction: "补充：仓库在 GitHub 开源",
    });

    expect(mocks.generate).toHaveBeenCalledTimes(2);
    const retryPrompt = mocks.generate.mock.calls[1][0] as string;
    expect(retryPrompt).toContain("上一版输出被拒绝");
    expect(retryPrompt).toContain("没有融合进知识框架");
    expect(result.success).toBe(true);
  });

  it("两次都是追加式 → 拒绝改写，不入队", async () => {
    const memory = makeMemory();
    const { memoryService, retriever } = makeDeps(memory);
    mocks.generate
      .mockResolvedValueOnce(llm(appendLike("仓库在 GitHub 开源")))
      .mockResolvedValueOnce(llm(appendLike("仓库在 GitHub 开源（重试版）")));

    const service = new MemoryCorrectionService(memoryService, retriever);
    const result = await service.correct({
      memoryId: "m1",
      instruction: "补充：仓库在 GitHub 开源",
    });

    expect(mocks.generate).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      success: false,
      error: "改写结果为末尾追加式而非框架融合，已拒绝",
    });
    expect(memoryService.stageUpdateMemory).not.toHaveBeenCalled();
  });

  it("融合式一次通过时不触发重试", async () => {
    const memory = makeMemory();
    const { memoryService, retriever } = makeDeps(memory);
    mocks.generate.mockResolvedValue(llm(fused));

    const service = new MemoryCorrectionService(memoryService, retriever);
    const result = await service.correct({
      memoryId: "m1",
      instruction: "补充：仓库在 GitHub 开源",
    });

    expect(mocks.generate).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
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
      content:
        '{"title": "项目名记录", "summary": "项目名记录", "content": "项目名是 Auto-Memories-Doll"}',
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

  it("改写 prompt 要求框架级融合：归位重组、重复合并、浑然一体，禁止末尾追加", async () => {
    const memory = makeMemory();
    const { memoryService, retriever } = makeDeps(memory);
    mocks.generate.mockResolvedValue({
      content:
        '{"title": "项目名记录", "summary": "项目名记录", "content": "项目名是 Auto-Memories-Doll"}',
      finishReason: "stop",
      model: "budget",
      timestamp: "2026-08-23T00:00:00.000Z",
    });

    const service = new MemoryCorrectionService(memoryService, retriever);
    await service.correct({ memoryId: "m1", instruction: "补充：仓库在 GitHub 开源" });

    expect(mocks.generate).toHaveBeenCalledTimes(1);
    const prompt = mocks.generate.mock.calls[0][0] as string;
    expect(prompt).toContain("纳入这条记忆的知识框架");
    expect(prompt).toContain("合并成一条更完整的表述");
    expect(prompt).toContain("像一开始就是这么写的");
    expect(prompt).toContain("禁止把新信息原样追加在正文末尾");
  });

  it("无 memoryId 时用 locateQuery 检索定位 top-1", async () => {
    const memory = makeMemory();
    const { memoryService, retriever } = makeDeps(memory);
    mocks.generate.mockResolvedValue({
      content:
        '{"title": "改过的标题", "summary": "项目名记录", "content": "项目名是 Auto-Memories-Doll"}',
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
      content:
        '{"title": "项目名记录", "summary": "新摘要", "content": "项目名是 Auto-Memories-Doll"}',
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
