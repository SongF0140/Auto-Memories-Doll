import { describe, it, expect } from "vitest";
import { buildMemoryRecord, buildPendingEvent, updateMemoryRecord } from "../lib/memory/builder";
import {
  validateMemoryRecord,
  validateVectorRecord,
  validatePendingEvent,
} from "../lib/memory/validator";
import { MEMORY_VERSION } from "../config/constants";
import { MemoryRecord, PendingEvent } from "../types/memory";

const validRecord: MemoryRecord = {
  id: "mem-1",
  version: MEMORY_VERSION,
  source: "test",
  sourceType: "manual",
  title: "标题",
  content: "内容",
  summary: "摘要",
  tags: ["a", "b"],
  topic: "uncategorized",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  accessedAt: "2026-01-01T00:00:00Z",
  accessCount: 0,
  heatScore: 0,
  graphLinks: [],
};

describe("buildMemoryRecord", () => {
  it("builds a record with defaults for optional fields", () => {
    const r = buildMemoryRecord("src", "manual", "t", "c", "s");
    expect(r.id).toBeTruthy();
    expect(r.version).toBe(MEMORY_VERSION);
    expect(r.tags).toEqual([]);
    expect(r.topic).toBe("uncategorized");
    expect(r.graphLinks).toEqual([]);
    expect(r.accessCount).toBe(0);
    expect(r.heatScore).toBe(0);
    expect(r.titleZh).toBeUndefined();
  });

  it("respects provided id and zh fields", () => {
    const r = buildMemoryRecord(
      "src", "chat", "t", "c", "s", ["x"], "topic-x", "custom-id",
      { titleZh: "中文标题", tagsZh: ["中文"] },
    );
    expect(r.id).toBe("custom-id");
    expect(r.titleZh).toBe("中文标题");
    expect(r.tagsZh).toEqual(["中文"]);
    expect(r.topic).toBe("topic-x");
  });

  it("sets createdAt/updatedAt/accessedAt to the same timestamp", () => {
    const r = buildMemoryRecord("src", "manual", "t", "c", "s");
    expect(r.createdAt).toBe(r.updatedAt);
    expect(r.createdAt).toBe(r.accessedAt);
  });
});

describe("buildPendingEvent", () => {
  it("serializes candidate to JSON string and initializes status fields", () => {
    const event = buildPendingEvent("mem-1", "manual", validRecord, ["title"]);
    expect(event.memoryId).toBe("mem-1");
    expect(event.sourceType).toBe("manual");
    expect(event.candidate).toBe(JSON.stringify(validRecord));
    expect(event.changedFields).toEqual(["title"]);
    expect(event.status).toBe("pending");
    expect(event.retryCount).toBe(0);
    expect(event.eventId).toBeTruthy();
  });

  it("preserves all sourceType values", () => {
    const types = ["chat", "ingest", "manual", "mcp", "skill", "listen"] as const;
    for (const t of types) {
      const event = buildPendingEvent("m", t, validRecord, []);
      expect(event.sourceType).toBe(t);
    }
  });
});

describe("updateMemoryRecord", () => {
  it("merges updates, bumps version and refreshes updatedAt", () => {
    const before = { ...validRecord, updatedAt: "2020-01-01T00:00:00Z" };
    const updated = updateMemoryRecord(before, { title: "新标题" });
    expect(updated.title).toBe("新标题");
    expect(updated.version).toBe(before.version + 1);
    expect(updated.updatedAt).not.toBe("2020-01-01T00:00:00Z");
    // 未改字段保留
    expect(updated.content).toBe(before.content);
  });
});

describe("validateMemoryRecord", () => {
  it("passes for a fully valid record", () => {
    expect(validateMemoryRecord(validRecord)).toBe(true);
  });

  it("rejects missing required string fields", () => {
    expect(validateMemoryRecord({ ...validRecord, id: "" })).toBe(false);
    expect(validateMemoryRecord({ ...validRecord, title: "" })).toBe(false);
    expect(validateMemoryRecord({ ...validRecord, source: "" })).toBe(false);
  });

  it("rejects invalid sourceType", () => {
    expect(validateMemoryRecord({ ...validRecord, sourceType: "invalid" as any })).toBe(false);
  });

  it("rejects non-array tags / graphLinks", () => {
    expect(validateMemoryRecord({ ...validRecord, tags: "x" as any })).toBe(false);
    expect(validateMemoryRecord({ ...validRecord, graphLinks: null as any })).toBe(false);
  });

  it("rejects wrong numeric types", () => {
    expect(validateMemoryRecord({ ...validRecord, accessCount: "0" as any })).toBe(false);
    expect(validateMemoryRecord({ ...validRecord, heatScore: undefined as any })).toBe(false);
  });

  it("accepts optional zh fields when valid", () => {
    expect(
      validateMemoryRecord({
        ...validRecord,
        titleZh: "中文标题",
        summaryZh: "中文摘要",
        tagsZh: ["中文"],
        topicZh: "中文话题",
      }),
    ).toBe(true);
  });

  it("accepts record without zh fields (all optional)", () => {
    expect(validateMemoryRecord(validRecord)).toBe(true);
  });

  it("rejects zh fields with wrong types", () => {
    expect(validateMemoryRecord({ ...validRecord, titleZh: 123 as any })).toBe(false);
    expect(validateMemoryRecord({ ...validRecord, summaryZh: [] as any })).toBe(false);
    expect(validateMemoryRecord({ ...validRecord, tagsZh: "not-array" as any })).toBe(false);
    expect(validateMemoryRecord({ ...validRecord, topicZh: {} as any })).toBe(false);
  });
});

describe("validateVectorRecord", () => {
  it("passes for a valid vector record", () => {
    expect(
      validateVectorRecord({
        memoryId: "m1",
        embedding: [0.1, 0.2],
        model: "text-embedding-3-small",
        dimensions: 2,
        updatedAt: "2026-01-01",
      }),
    ).toBe(true);
  });

  it("rejects empty embedding array (length must be > 0)", () => {
    // 修复后：embedding 必须是非空数组，空数组 [] 不再放行
    expect(
      validateVectorRecord({
        memoryId: "m1",
        embedding: [],
        model: "x",
        dimensions: 1,
        updatedAt: "2026-01-01",
      }),
    ).toBe(false);
  });

  it("rejects missing memoryId / model / updatedAt", () => {
    expect(validateVectorRecord({ embedding: [0.1], model: "x", dimensions: 1, updatedAt: "t" } as any)).toBe(false);
    expect(validateVectorRecord({ memoryId: "m", embedding: [0.1], dimensions: 1, updatedAt: "t" } as any)).toBe(false);
  });
});

describe("validatePendingEvent", () => {
  const validEvent: PendingEvent = {
    eventId: "e1",
    memoryId: "m1",
    sourceType: "manual",
    candidate: "{}",
    changedFields: [],
    createdAt: "2026-01-01",
    status: "pending",
    retryCount: 0,
  };

  it("passes for a valid event", () => {
    expect(validatePendingEvent(validEvent)).toBe(true);
  });

  it("accepts 'listen' sourceType (whitelist now includes all 6 types)", () => {
    // 修复后：validatePendingEvent 的 sourceType 白名单已补全 listen，与 PendingEvent 类型一致
    expect(validatePendingEvent({ ...validEvent, sourceType: "listen" })).toBe(true);
  });

  it("rejects unknown sourceType", () => {
    expect(validatePendingEvent({ ...validEvent, sourceType: "invalid" as any })).toBe(false);
  });

  it("rejects invalid status", () => {
    expect(validatePendingEvent({ ...validEvent, status: "unknown" as any })).toBe(false);
  });
});
