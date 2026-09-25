import { describe, it, expect, beforeEach, vi } from "vitest";

// ModelAdapter 捕获器：记录 generate 调用，注入响应/降级/异常
const { adapterMock, generateCapture } = vi.hoisted(() => ({
  adapterMock: { degraded: false, fail: false, response: "" },
  generateCapture: { fn: vi.fn() },
}));

vi.mock("../lib/ai/model-adapter", () => ({
  ModelAdapter: {
    get isDegradedMode() {
      return adapterMock.degraded;
    },
    generate: (...args: unknown[]) => generateCapture.fn(...args),
  },
}));

import { ReflectService } from "../server/services/reflect-service";
import { VectorRetriever } from "../lib/vector/retriever";
import { MemoryService } from "../server/services/memory-service";

const retriever = {
  searchDetailed: vi.fn(),
  close: vi.fn(),
};

const memoryService = {
  getMemoriesByIds: vi.fn(),
  close: vi.fn(),
};

function makeDeps() {
  return {
    retriever: retriever as unknown as Pick<VectorRetriever, "searchDetailed" | "close">,
    memoryService: memoryService as unknown as Pick<MemoryService, "getMemoriesByIds" | "close">,
  };
}

const HITS = {
  results: [{ memoryId: "mem-1", similarity: 0.72 }],
  mode: "hybrid",
  route: "single-hop",
};

describe("ReflectService（Reflect 式推理闭环）", () => {
  let svc: ReflectService;

  beforeEach(() => {
    vi.clearAllMocks();
    adapterMock.degraded = false;
    adapterMock.fail = false;
    adapterMock.response = "推理结论（卡: mem-1）";
    generateCapture.fn.mockResolvedValue({ content: adapterMock.response });
    svc = new ReflectService(makeDeps());
  });

  it("检索命中 → 组装卡片上下文 → 返回带依据的推理结果", async () => {
    retriever.searchDetailed.mockResolvedValue(HITS);
    memoryService.getMemoriesByIds.mockReturnValue([
      { id: "mem-1", title: "卡一", summary: "摘要一", content: "正文一" },
    ]);

    const result = await svc.reflect("X 和 Y 哪个对", "skeptical", 6);

    expect(retriever.searchDetailed).toHaveBeenCalledWith("X 和 Y 哪个对", 6);
    expect(memoryService.getMemoriesByIds).toHaveBeenCalledWith(["mem-1"]);
    expect(result.disposition).toBe("skeptical");
    expect(result.degraded).toBe(false);
    expect(result.usedMemoryIds).toEqual(["mem-1"]);
    expect(result.memories[0]).toMatchObject({ id: "mem-1", summary: "摘要一", similarity: 0.72 });
    expect(result.answer).toContain("推理结论");
  });

  it("skeptical disposition 的指令与卡片 id 进入 prompt", async () => {
    retriever.searchDetailed.mockResolvedValue(HITS);
    memoryService.getMemoriesByIds.mockReturnValue([
      { id: "mem-1", title: "t", summary: "s", content: "c" },
    ]);

    await svc.reflect("问题", "skeptical");

    const prompt = generateCapture.fn.mock.calls[0][0] as string;
    expect(prompt).toContain("怀疑视角");
    expect(prompt).toContain("id: mem-1");
    expect(prompt).toContain("问题：问题");
  });

  it("无相关记忆 → 直接短路返回，不调 LLM", async () => {
    retriever.searchDetailed.mockResolvedValue({
      results: [],
      mode: "vector",
      route: "single-hop",
    });

    const result = await svc.reflect("问题");

    expect(result.answer).toContain("没有与该问题相关的记忆");
    expect(result.usedMemoryIds).toEqual([]);
    expect(generateCapture.fn).not.toHaveBeenCalled();
  });

  it("模型降级 → fail-soft：degraded=true，检索结果仍返回", async () => {
    adapterMock.degraded = true;
    retriever.searchDetailed.mockResolvedValue(HITS);
    memoryService.getMemoriesByIds.mockReturnValue([
      { id: "mem-1", title: "t", summary: "s", content: "c" },
    ]);

    const result = await svc.reflect("问题");

    expect(result.degraded).toBe(true);
    expect(result.usedMemoryIds).toEqual(["mem-1"]);
    expect(result.answer).toContain("降级");
  });

  it("LLM 调用异常 → answer 携带失败原因，不炸调用方", async () => {
    adapterMock.fail = true;
    generateCapture.fn.mockRejectedValue(new Error("LLM 超时"));
    retriever.searchDetailed.mockResolvedValue(HITS);
    memoryService.getMemoriesByIds.mockReturnValue([
      { id: "mem-1", title: "t", summary: "s", content: "c" },
    ]);

    const result = await svc.reflect("问题");

    expect(result.degraded).toBe(false);
    expect(result.answer).toContain("推理调用失败");
    expect(result.memories).toHaveLength(1);
  });
});
