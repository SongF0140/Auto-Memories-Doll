import { describe, it, expect, beforeEach, vi } from "vitest";
import { MemoryRecord } from "../types/memory";

vi.mock("../lib/ai/model-adapter", () => ({
  ModelAdapter: {
    isDegradedMode: false,
    generate: vi.fn(),
  },
}));

import { ModelAdapter } from "../lib/ai/model-adapter";
import { StructureLintService, issueKeyOf } from "../server/services/structure-lint-service";

function makeMemory(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id: "m1",
    version: 1,
    source: "test",
    sourceType: "manual",
    title: "标题",
    content: "正文",
    summary: "摘要",
    tags: ["tag"],
    topic: "topic-a",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    accessedAt: "2026-01-01",
    accessCount: 0,
    heatScore: 0,
    graphLinks: [],
    ...overrides,
  } as MemoryRecord;
}

describe("StructureLintService", () => {
  let service: StructureLintService;

  beforeEach(() => {
    service = new StructureLintService();
  });

  it("检出死链：graphLinks 指向不存在的记忆", () => {
    const issues = service.run([
      makeMemory({ id: "a", graphLinks: ["b"] }),
      makeMemory({ id: "c" }),
    ]);
    const dead = issues.find((i) => i.type === "dead-link");
    expect(dead).toEqual({ type: "dead-link", from: "a", to: "b" });
  });

  it("有效链路不算死链", () => {
    const issues = service.run([
      makeMemory({ id: "a", graphLinks: ["b"] }),
      makeMemory({ id: "b", topic: "topic-a" }),
    ]);
    expect(issues.filter((i) => i.type === "dead-link")).toHaveLength(0);
  });

  it("检出孤儿页：无出边、无入边、同 topic 无邻居", () => {
    const issues = service.run([makeMemory({ id: "lonely" })]);
    expect(issues.some((i) => i.type === "orphan")).toBe(true);
  });

  it("有入链或有邻居的卡片不是孤儿", () => {
    const issues = service.run([
      makeMemory({ id: "a", graphLinks: ["b"], topic: "t" }),
      makeMemory({ id: "b", topic: "t" }),
    ]);
    expect(issues.filter((i) => i.type === "orphan")).toHaveLength(0);
  });

  it("检出残缺卡：必需字段缺失", () => {
    const issues = service.run([makeMemory({ id: "bad", title: "", tags: [], summary: "有" })]);
    const incomplete = issues.find((i) => i.type === "incomplete-card");
    expect(incomplete).toEqual({
      type: "incomplete-card",
      memoryId: "bad",
      missing: ["title", "tags"],
    });
  });

  it("检出重复来源哈希并聚组", () => {
    const issues = service.run([
      makeMemory({ id: "a", evidence: { text: "x", sourceHash: "hash-1" } }),
      makeMemory({ id: "b", evidence: { text: "y", sourceHash: "hash-1" } }),
      makeMemory({ id: "c", evidence: { text: "z", sourceHash: "hash-2" } }),
    ]);
    const dup = issues.find((i) => i.type === "duplicate-hash");
    expect(dup).toEqual({ type: "duplicate-hash", memoryIds: ["a", "b"] });
  });

  it("零 LLM 调用（结构检查必须便宜）", () => {
    service.run([makeMemory()]);
    expect(ModelAdapter.generate).not.toHaveBeenCalled();
  });

  it("persist 对同一问题去重，不无限堆积", () => {
    const memories = [makeMemory({ id: "lonely" })];
    const first = service.persist(service.run(memories));
    const second = service.persist(service.run(memories));

    expect(first).toBeGreaterThan(0);
    expect(second).toBe(0);
    expect(service.listOpen("orphan")).toHaveLength(1);
  });

  it("scanAndPersist 一步返回问题与新增数", () => {
    const { issues, added } = service.scanAndPersist([makeMemory({ id: "x", title: "" })]);
    expect(issues.length).toBeGreaterThan(0);
    expect(added).toBe(issues.length);
  });

  it("issueKeyOf 生成稳定去重键", () => {
    expect(issueKeyOf({ type: "dead-link", from: "a", to: "b" })).toBe("a->b");
    expect(issueKeyOf({ type: "orphan", memoryId: "m" })).toBe("m");
    expect(issueKeyOf({ type: "duplicate-hash", memoryIds: ["b", "a"] })).toBe("b|a");
  });
});
