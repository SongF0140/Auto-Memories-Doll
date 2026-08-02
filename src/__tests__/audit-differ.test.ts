import { describe, it, expect } from "vitest";
import { compareMemories, extractChangedFields } from "../features/audit/differ";
import { resolveConflicts } from "../features/audit/conflict-resolver";
import { MemoryRecord } from "../types/memory";

const baseRecord: MemoryRecord = {
  id: "mem-1",
  version: 1,
  source: "test",
  sourceType: "manual",
  title: "原标题",
  content: "原内容",
  summary: "原摘要",
  tags: ["a", "b"],
  topic: "uncategorized",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  accessedAt: "2026-01-01T00:00:00Z",
  accessCount: 0,
  heatScore: 0,
  graphLinks: [],
};

describe("compareMemories", () => {
  it("returns empty diffs when records are identical on tracked fields", () => {
    const candidate = { ...baseRecord };
    const diffs = compareMemories(baseRecord, candidate);
    expect(diffs).toEqual([]);
  });

  it("detects single field change", () => {
    const candidate = { ...baseRecord, title: "新标题" };
    const diffs = compareMemories(baseRecord, candidate);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].field).toBe("title");
    expect(diffs[0].type).toBe("changed");
    expect(diffs[0].existingValue).toBe("原标题");
    expect(diffs[0].candidateValue).toBe("新标题");
  });

  it("detects multiple field changes", () => {
    const candidate = { ...baseRecord, title: "T2", content: "C2", summary: "S2" };
    const fields = compareMemories(baseRecord, candidate).map((d) => d.field);
    expect(fields.sort()).toEqual(["content", "summary", "title"]);
  });

  it("detects tags array change via JSON.stringify comparison", () => {
    const candidate = { ...baseRecord, tags: ["a", "b", "c"] };
    const diffs = compareMemories(baseRecord, candidate);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].field).toBe("tags");
  });

  it("does NOT report diff when only untracked fields change (e.g. accessCount)", () => {
    const candidate = { ...baseRecord, accessCount: 99, heatScore: 0.5 };
    expect(compareMemories(baseRecord, candidate)).toEqual([]);
  });

  it("tracks graphLinks changes", () => {
    const candidate = { ...baseRecord, graphLinks: ["mem-2"] };
    const diffs = compareMemories(baseRecord, candidate);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].field).toBe("graphLinks");
  });
});

describe("extractChangedFields", () => {
  it("returns field names from diffs in order", () => {
    const diffs = [
      { field: "title", type: "changed" as const },
      { field: "tags", type: "changed" as const },
    ];
    expect(extractChangedFields(diffs)).toEqual(["title", "tags"]);
  });

  it("returns empty array for empty diffs", () => {
    expect(extractChangedFields([])).toEqual([]);
  });
});

describe("resolveConflicts", () => {
  it("auto_merges when changed fields have identical values", () => {
    const candidate = { ...baseRecord, title: "原标题" }; // 同值
    const result = resolveConflicts(baseRecord, candidate, ["title"]);
    expect(result.action).toBe("auto_merge");
  });

  it("auto_merges tags by union (no conflict)", () => {
    const candidate = { ...baseRecord, tags: ["b", "c"] };
    const result = resolveConflicts(baseRecord, candidate, ["tags"]);
    expect(result.action).toBe("auto_merge");
    if (result.action === "auto_merge") {
      expect(result.merged.tags).toEqual(["a", "b", "c"]);
    }
  });

  it("auto_merges graphLinks by union", () => {
    const candidate = { ...baseRecord, graphLinks: ["g2"] };
    const result = resolveConflicts(baseRecord, candidate, ["graphLinks"]);
    expect(result.action).toBe("auto_merge");
    if (result.action === "auto_merge") {
      expect(result.merged.graphLinks).toEqual(["g2"]);
    }
  });

  it("returns manual_decision when scalar field values differ", () => {
    const candidate = { ...baseRecord, title: "不同标题" };
    const result = resolveConflicts(baseRecord, candidate, ["title"]);
    expect(result.action).toBe("manual_decision");
    if (result.action === "manual_decision") {
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].field).toBe("title");
      expect(result.conflicts[0].existingValue).toBe("原标题");
      expect(result.conflicts[0].candidateValue).toBe("不同标题");
    }
  });

  it("returns manual_decision when content differs", () => {
    const candidate = { ...baseRecord, content: "新内容" };
    const result = resolveConflicts(baseRecord, candidate, ["content"]);
    expect(result.action).toBe("manual_decision");
  });

  it("skips version / id / createdAt fields even if changed", () => {
    const candidate = { ...baseRecord, id: "different-id", version: 99, createdAt: "1999-01-01" };
    const result = resolveConflicts(baseRecord, candidate, ["id", "version", "createdAt"]);
    expect(result.action).toBe("auto_merge");
  });

  it("collects multiple conflicts in one manual_decision result", () => {
    const candidate = { ...baseRecord, title: "T", content: "C", summary: "S" };
    const result = resolveConflicts(baseRecord, candidate, ["title", "content", "summary"]);
    expect(result.action).toBe("manual_decision");
    if (result.action === "manual_decision") {
      expect(result.conflicts).toHaveLength(3);
    }
  });

  it("mixed: tags auto-merge + title conflict yields manual_decision", () => {
    const candidate = { ...baseRecord, tags: ["c"], title: "新标题" };
    const result = resolveConflicts(baseRecord, candidate, ["tags", "title"]);
    expect(result.action).toBe("manual_decision");
    if (result.action === "manual_decision") {
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].field).toBe("title");
    }
  });

  it("empty changedFields yields auto_merge with empty merged", () => {
    const result = resolveConflicts(baseRecord, baseRecord, []);
    expect(result.action).toBe("auto_merge");
    if (result.action === "auto_merge") {
      expect(result.merged).toEqual({});
    }
  });
});

describe("resolveConflicts — reject 路径", () => {
  it("rejects when candidate.version < existing.version (schema 不兼容)", () => {
    const existing = { ...baseRecord, version: 5 };
    const candidate = { ...baseRecord, version: 3, title: "新标题" };
    const result = resolveConflicts(existing, candidate, ["title"]);
    expect(result.action).toBe("reject");
    if (result.action === "reject") {
      expect(result.reason).toContain("版本不兼容");
      expect(result.reason).toContain("3");
      expect(result.reason).toContain("5");
    }
  });

  it("does NOT reject when candidate.version === existing.version", () => {
    const existing = { ...baseRecord, version: 5 };
    const candidate = { ...baseRecord, version: 5, title: "新标题" };
    const result = resolveConflicts(existing, candidate, ["title"]);
    // version 相同应进入正常比对，title 不同 → manual_decision
    expect(result.action).toBe("manual_decision");
  });

  it("does NOT reject when candidate.version > existing.version (升级)", () => {
    const existing = { ...baseRecord, version: 3 };
    const candidate = { ...baseRecord, version: 5, title: "新标题" };
    const result = resolveConflicts(existing, candidate, ["title"]);
    expect(result.action).toBe("manual_decision");
  });

  it("rejects when candidate.title is empty (数据损坏)", () => {
    const candidate = { ...baseRecord, title: "" };
    const result = resolveConflicts(baseRecord, candidate, ["title"]);
    expect(result.action).toBe("reject");
    if (result.action === "reject") {
      expect(result.reason).toContain("数据损坏");
      expect(result.reason).toContain("title");
    }
  });

  it("rejects when candidate.id is empty", () => {
    const candidate = { ...baseRecord, id: "" };
    const result = resolveConflicts(baseRecord, candidate, ["title"]);
    expect(result.action).toBe("reject");
    if (result.action === "reject") {
      expect(result.reason).toContain("数据损坏");
    }
  });

  it("rejects when candidate.content is empty", () => {
    const candidate = { ...baseRecord, content: "" };
    const result = resolveConflicts(baseRecord, candidate, ["content"]);
    expect(result.action).toBe("reject");
  });

  it("rejects when candidate.summary is empty", () => {
    const candidate = { ...baseRecord, summary: "" };
    const result = resolveConflicts(baseRecord, candidate, ["summary"]);
    expect(result.action).toBe("reject");
  });

  it("rejects when candidate.tags is not an array (格式校验失败)", () => {
    const candidate = { ...baseRecord, tags: "not-an-array" as any };
    const result = resolveConflicts(baseRecord, candidate, ["tags"]);
    expect(result.action).toBe("reject");
    if (result.action === "reject") {
      expect(result.reason).toContain("格式校验失败");
      expect(result.reason).toContain("tags");
    }
  });

  it("rejects when candidate.graphLinks is not an array", () => {
    const candidate = { ...baseRecord, graphLinks: null as any };
    const result = resolveConflicts(baseRecord, candidate, ["graphLinks"]);
    expect(result.action).toBe("reject");
    if (result.action === "reject") {
      expect(result.reason).toContain("graphLinks");
    }
  });

  it("reject takes priority over field comparison (version check before diff)", () => {
    // 同时满足 reject（version 低）和 manual_decision（title 不同）
    // 应该先 reject，不进入字段比对
    const existing = { ...baseRecord, version: 10, title: "原标题" };
    const candidate = { ...baseRecord, version: 1, title: "新标题" };
    const result = resolveConflicts(existing, candidate, ["title"]);
    expect(result.action).toBe("reject");
  });

  it("reject takes priority over auto_merge (data corruption before merge)", () => {
    // 同时满足 reject（title 空）和 auto_merge（tags 可合并）
    const existing = { ...baseRecord, tags: ["a"] };
    const candidate = { ...baseRecord, title: "", tags: ["b"] };
    const result = resolveConflicts(existing, candidate, ["title", "tags"]);
    expect(result.action).toBe("reject");
  });
});
