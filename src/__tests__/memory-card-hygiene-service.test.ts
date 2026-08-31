import { describe, expect, it } from "vitest";
import { MemoryRecord } from "../types/memory";
import { MemoryCardHygieneService } from "../server/services/memory-card-hygiene-service";

function makeMemory(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id: "m1",
    version: 2,
    source: "test",
    sourceType: "manual",
    title: "中文标题",
    summary: "清晰摘要",
    content: "## 背景\n\n这是一条结构清晰、表达顺畅的中文记忆。",
    tags: ["中文"],
    topic: "learning",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    accessedAt: "2026-01-01T00:00:00Z",
    accessCount: 0,
    heatScore: 0,
    graphLinks: [],
    ...overrides,
  };
}

describe("MemoryCardHygieneService", () => {
  it("识别旧记忆卡片的乱码、英文残留、格式不当和叙述不通顺", () => {
    const service = new MemoryCardHygieneService();
    const result = service.inspect(
      makeMemory({
        title: "Old broken card",
        summary: "This summary has too many English words and ???? symbols",
        content:
          "###BadHeading\n-item\nThis memory card contains unreadable �� text and repeated!!!!!!!! content.",
      }),
    );

    expect(result.needsOptimization).toBe(true);
    expect(result.issues).toEqual(expect.arrayContaining(["garbled", "english", "markdown"]));
  });

  it("构建保守优化候选时只清理文本并追加旧记忆优化标签", () => {
    const service = new MemoryCardHygieneService();
    const optimized = service.buildFallbackOptimization(
      makeMemory({
        title: "????",
        summary: "坏摘要 ��",
        content: "###BadHeading\n-item ��",
        tags: ["原标签"],
      }),
      ["garbled", "markdown"],
    );

    expect(optimized.title).toBe("旧记忆卡片优化");
    expect(optimized.summary).not.toContain("��");
    expect(optimized.content).toContain("### BadHeading");
    expect(optimized.content).toContain("- item");
    expect(optimized.tags).toEqual(expect.arrayContaining(["原标签", "旧记忆优化"]));
  });

  it("已经带旧记忆优化标签的候选不会再次触发卫生门禁", () => {
    const service = new MemoryCardHygieneService();

    expect(service.isOptimizationCandidate(makeMemory({ tags: ["旧记忆优化"] }))).toBe(true);
  });
});
