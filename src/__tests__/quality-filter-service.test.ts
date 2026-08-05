import { describe, it, expect, vi, beforeEach } from "vitest";

// ── mock ModelAdapter ──
vi.mock("../lib/ai/model-adapter", () => ({
  ModelAdapter: {
    generate: vi.fn(),
    isDegradedMode: false,
  },
}));

import { QualityFilterService } from "../server/services/quality-filter-service";
import { MemoryRecord } from "../types/memory";
import { ModelAdapter } from "../lib/ai/model-adapter";

const makeCandidate = (overrides: Partial<MemoryRecord> = {}): MemoryRecord => ({
  id: "mem-1",
  version: 2,
  source: "test",
  sourceType: "manual",
  title: "Test Memory",
  content: "This is a valuable insight about software architecture.",
  summary: "Valuable insight",
  tags: ["architecture"],
  topic: "tech",
  graphLinks: [],
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
  accessedAt: "2026-01-01",
  accessCount: 0,
  heatScore: 0,
  ...overrides,
});

describe("QualityFilterService", () => {
  let service: QualityFilterService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new QualityFilterService();
  });

  it("降级模式自动放行", async () => {
    (ModelAdapter as any).isDegradedMode = true;

    const result = await service.filter(makeCandidate());

    expect(result.ok).toBe(true);
    (ModelAdapter as any).isDegradedMode = false;
  });

  it("LLM 返回 PASS → 放行", async () => {
    (ModelAdapter.generate as any).mockResolvedValue({ content: "PASS", finishReason: "stop", model: "test", timestamp: Date.now() });

    const result = await service.filter(makeCandidate());

    expect(result.ok).toBe(true);
  });

  it("LLM 返回 FAIL → 拦截，返回原因", async () => {
    (ModelAdapter.generate as any).mockResolvedValue({ content: "FAIL: 内容过于空泛", finishReason: "stop", model: "test", timestamp: Date.now() });

    const result = await service.filter(makeCandidate());

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("内容过于空泛");
  });

  it("LLM 返回 FAIL 无冒号 → 使用默认原因", async () => {
    (ModelAdapter.generate as any).mockResolvedValue({ content: "FAIL", finishReason: "stop", model: "test", timestamp: Date.now() });

    const result = await service.filter(makeCandidate());

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("质量未达标");
  });

  it("LLM 返回非标准输出 → 放行（避免误杀）", async () => {
    (ModelAdapter.generate as any).mockResolvedValue({ content: "这是一个好记忆", finishReason: "stop", model: "test", timestamp: Date.now() });

    const result = await service.filter(makeCandidate());

    expect(result.ok).toBe(true);
  });

  it("API 调用异常 → 放行", async () => {
    (ModelAdapter.generate as any).mockRejectedValue(new Error("Network error"));

    const result = await service.filter(makeCandidate());

    expect(result.ok).toBe(true);
  });

  it("空泛内容 → FAIL 拦截", async () => {
    (ModelAdapter.generate as any).mockResolvedValue({ content: "FAIL: 无实质内容", finishReason: "stop", model: "test", timestamp: Date.now() });

    const result = await service.filter(
      makeCandidate({ content: "好的", title: "ok" }),
    );

    expect(result.ok).toBe(false);
  });

  it("PASS 不区分大小写", async () => {
    (ModelAdapter.generate as any).mockResolvedValue({ content: "pass", finishReason: "stop", model: "test", timestamp: Date.now() });

    const result = await service.filter(makeCandidate());

    expect(result.ok).toBe(true);
  });

  it("FAIL 不区分大小写", async () => {
    (ModelAdapter.generate as any).mockResolvedValue({ content: "fail: 不相关", finishReason: "stop", model: "test", timestamp: Date.now() });

    const result = await service.filter(makeCandidate());

    expect(result.ok).toBe(false);
  });
});
