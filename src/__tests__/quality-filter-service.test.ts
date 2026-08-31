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

const llmReply = (json: unknown) => ({
  content: typeof json === "string" ? json : JSON.stringify(json),
  finishReason: "stop",
  model: "test",
  timestamp: Date.now(),
});

describe("QualityFilterService", () => {
  let service: QualityFilterService;

  beforeEach(() => {
    vi.clearAllMocks();
    (ModelAdapter as any).isDegradedMode = false;
    service = new QualityFilterService();
  });

  it("降级模式 → review（fail-closed，转人工裁决）", async () => {
    (ModelAdapter as any).isDegradedMode = true;

    const result = await service.filter(makeCandidate());

    expect(result.verdict).toBe("review");
    expect(ModelAdapter.generate).not.toHaveBeenCalled();
  });

  it("score ≥ 7 → accept", async () => {
    (ModelAdapter.generate as any).mockResolvedValue(llmReply({ score: 9, reason: "含具体决策" }));

    const result = await service.filter(makeCandidate());

    expect(result).toMatchObject({ verdict: "accept", score: 9 });
  });

  it("score = 7 → review（严格筛选，避免把边缘内容误放行）", async () => {
    (ModelAdapter.generate as any).mockResolvedValue(llmReply({ score: 7, reason: "还不够扎实" }));

    const result = await service.filter(makeCandidate());

    expect(result).toMatchObject({ verdict: "review", score: 7 });
  });

  it("4 ≤ score < 7 → review（灰区转人工）", async () => {
    (ModelAdapter.generate as any).mockResolvedValue(llmReply({ score: 5, reason: "信息量一般" }));

    const result = await service.filter(makeCandidate());

    expect(result).toMatchObject({ verdict: "review", score: 5 });
  });

  it("score < 4 → reject，返回原因", async () => {
    (ModelAdapter.generate as any).mockResolvedValue(llmReply({ score: 2, reason: "空泛无实质" }));

    const result = await service.filter(makeCandidate());

    expect(result).toMatchObject({ verdict: "reject", score: 2, reason: "空泛无实质" });
  });

  it("score 越界 → clamp 到 0-10", async () => {
    (ModelAdapter.generate as any).mockResolvedValue(llmReply({ score: 42 }));

    const result = await service.filter(makeCandidate());

    expect(result).toMatchObject({ verdict: "accept", score: 10 });
  });

  it("markdown 代码块包裹的 JSON 也能解析", async () => {
    (ModelAdapter.generate as any).mockResolvedValue(
      llmReply('```json\n{"score": 8, "reason": "有价值"}\n```'),
    );

    const result = await service.filter(makeCandidate());

    expect(result.verdict).toBe("accept");
  });

  it("非标准输出 → 重试一次后仍失败 → review", async () => {
    (ModelAdapter.generate as any).mockResolvedValue(llmReply("这是一个好记忆"));

    const result = await service.filter(makeCandidate());

    expect(ModelAdapter.generate).toHaveBeenCalledTimes(2);
    expect(result.verdict).toBe("review");
  });

  it("第一次输出异常、第二次正常 → 返回正常判定", async () => {
    (ModelAdapter.generate as any)
      .mockResolvedValueOnce(llmReply("抱歉我无法判断"))
      .mockResolvedValueOnce(llmReply({ score: 8, reason: "ok" }));

    const result = await service.filter(makeCandidate());

    expect(result.verdict).toBe("accept");
  });

  it("API 调用异常 → review（不再放行）", async () => {
    (ModelAdapter.generate as any).mockRejectedValue(new Error("Network error"));

    const result = await service.filter(makeCandidate());

    expect(result.verdict).toBe("review");
  });

  it("相似记忆提示注入 prompt（新颖性判断上下文）", async () => {
    (ModelAdapter.generate as any).mockResolvedValue(llmReply({ score: 8 }));

    await service.filter(makeCandidate(), [
      { title: "已有记忆", summary: "已有摘要", similarity: 0.8 },
    ]);

    const prompt = (ModelAdapter.generate as any).mock.calls[0][0] as string;
    expect(prompt).toContain("已有记忆");
    expect(prompt).toContain("80%");
  });

  // ═══════════════════════════════════════════════════════════════
  // kind 分类与证据约束
  // ═══════════════════════════════════════════════════════════════

  it("kind=inference 且评分达标 → 仍转 review（非事实只能进待验证区）", async () => {
    (ModelAdapter.generate as any).mockResolvedValue(
      llmReply({ score: 9, kind: "inference", reason: "推导结论" }),
    );

    const result = await service.filter(makeCandidate({ evidence: { text: "原文片段" } }));

    expect(result.verdict).toBe("review");
    expect(result).toMatchObject({ kind: "inference" });
  });

  it("kind=hypothesis / insight 同样强制 review", async () => {
    for (const kind of ["hypothesis", "insight"] as const) {
      (ModelAdapter.generate as any).mockResolvedValue(llmReply({ score: 9, kind }));

      const result = await service.filter(makeCandidate({ evidence: { text: "原文片段" } }));

      expect(result.verdict).toBe("review");
    }
  });

  it("kind 输出非法值 → 视为 fact", async () => {
    (ModelAdapter.generate as any).mockResolvedValue(
      llmReply({ score: 9, kind: "rumor", reason: "ok" }),
    );

    const result = await service.filter(makeCandidate({ evidence: { text: "原文片段" } }));

    expect(result.verdict).toBe("accept");
    expect(result).toMatchObject({ kind: "fact" });
  });

  it("采集类入口（ingest）fact 无证据 → review，不得自动入库", async () => {
    (ModelAdapter.generate as any).mockResolvedValue(llmReply({ score: 9, kind: "fact" }));

    const result = await service.filter(makeCandidate({ sourceType: "ingest" }));

    expect(result.verdict).toBe("review");
    expect(result.reason).toContain("证据");
  });

  it("采集类入口（listen）fact 带证据 → 正常 accept", async () => {
    (ModelAdapter.generate as any).mockResolvedValue(llmReply({ score: 9, kind: "fact" }));

    const result = await service.filter(
      makeCandidate({
        sourceType: "listen",
        evidence: { text: "对话原文片段", location: "https://x" },
      }),
    );

    expect(result.verdict).toBe("accept");
  });

  it("白名单外入口（manual/chat）无证据不强制 review", async () => {
    (ModelAdapter.generate as any).mockResolvedValue(llmReply({ score: 9, kind: "fact" }));

    const result = await service.filter(makeCandidate({ sourceType: "manual" }));

    expect(result.verdict).toBe("accept");
  });

  it("证据片段注入 prompt", async () => {
    (ModelAdapter.generate as any).mockResolvedValue(llmReply({ score: 8 }));

    await service.filter(
      makeCandidate({ evidence: { text: "关键原文片段", location: "docs/a.md" } }),
    );

    const prompt = (ModelAdapter.generate as any).mock.calls[0][0] as string;
    expect(prompt).toContain("关键原文片段");
    expect(prompt).toContain("docs/a.md");
  });
});
