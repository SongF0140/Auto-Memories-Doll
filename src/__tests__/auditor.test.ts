import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import Database from "better-sqlite3";

// ── mock 共享 SQLite 连接 → 内存数据库（VersionManager 需要）──
const { dbRef } = vi.hoisted(() => ({ dbRef: { current: null as Database.Database | null } }));

vi.mock("../lib/storage/database", () => ({
  getDatabase: () => dbRef.current,
  closeDatabase: () => {
    if (dbRef.current) {
      dbRef.current.close();
      dbRef.current = null;
    }
  },
}));

import { Auditor, MemoryStoreReader } from "../features/audit/auditor";
import { VersionManager } from "../features/audit/version-manager";
import { MemoryRecord, PendingEvent } from "../types/memory";

beforeAll(() => {
  dbRef.current = new Database(":memory:");
  dbRef.current.pragma("journal_mode = WAL");
  // 触发 memory_snapshots 表的 CREATE TABLE IF NOT EXISTS
  new VersionManager().close();
});

beforeEach(() => {
  // 清空快照表，避免前一个测试的 snapshot 干扰
  dbRef.current!.exec("DELETE FROM memory_snapshots");
});

function makeMemory(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
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
    ...overrides,
  };
}

function makeEvent(memoryId: string, candidate: MemoryRecord, changedFields: string[]): PendingEvent {
  return {
    eventId: `evt-${memoryId}-${Math.random().toString(36).slice(2, 6)}`,
    memoryId,
    sourceType: "manual",
    candidate: JSON.stringify(candidate),
    changedFields,
    createdAt: "2026-01-01T00:00:00Z",
    status: "pending",
    retryCount: 0,
  };
}

/**
 * 构造一个 mock store：可控的 getMemory / dequeueEvent / updateEvent
 * 避免依赖真实 MemoryService，聚焦测试 Auditor 自身逻辑
 * 注：dequeueCalls / updateEventCalls 通过 getter 暴露，避免 number 值拷贝问题
 */
function makeMockStore(opts: {
  memory?: MemoryRecord | null;
  event?: PendingEvent | null;
}): MemoryStoreReader & { updateEventCalls: PendingEvent[]; dequeueCalls: number } {
  const currentMemory = opts.memory !== undefined ? opts.memory : null;
  let currentEvent = opts.event ?? null;
  let dequeueCount = 0;
  const updateCalls: PendingEvent[] = [];

  const store: any = {
    getMemory: (_id: string) => currentMemory,
    dequeueEvent: (_memoryId: string) => {
      dequeueCount++;
      return currentEvent;
    },
    updateEvent: (event: PendingEvent) => {
      updateCalls.push(event);
      currentEvent = event;
    },
  };
  Object.defineProperty(store, "dequeueCalls", { get: () => dequeueCount });
  Object.defineProperty(store, "updateEventCalls", { get: () => updateCalls });
  return store as MemoryStoreReader & { updateEventCalls: PendingEvent[]; dequeueCalls: number };
}

describe("Auditor.process — 三种分流", () => {
  it("returns null when no pending event in queue", async () => {
    const store = makeMockStore({ event: null });
    const auditor = new Auditor(store);
    expect(await auditor.process("m1")).toBeNull();
    expect(store.dequeueCalls).toBe(1);
  });

  it("returns status=done when no existing memory (new memory)", async () => {
    const candidate = makeMemory({ id: "m1" });
    const event = makeEvent("m1", candidate, ["title"]);
    const store = makeMockStore({ memory: null, event });
    const auditor = new Auditor(store);

    const result = await auditor.process("m1");
    expect(result).not.toBeNull();
    expect(result!.status).toBe("done");
    expect(result!.eventId).toBe(event.eventId);
    expect(result!.diffs).toEqual([]);
  });

  it("returns status=done when diffs are empty (identical)", async () => {
    const existing = makeMemory({ id: "m1", title: "T" });
    const candidate = makeMemory({ id: "m1", title: "T" }); // 同值
    const event = makeEvent("m1", candidate, ["title"]);
    const store = makeMockStore({ memory: existing, event });
    const auditor = new Auditor(store);

    const result = await auditor.process("m1");
    expect(result!.status).toBe("done");
    expect(result!.diffs).toHaveLength(0);
  });

  it("returns status=done with auto_merge when only tags differ (auto-mergeable)", async () => {
    const existing = makeMemory({ id: "m1", tags: ["a"] });
    const candidate = makeMemory({ id: "m1", tags: ["a", "b"] });
    const event = makeEvent("m1", candidate, ["tags"]);
    const store = makeMockStore({ memory: existing, event });
    const auditor = new Auditor(store);

    const result = await auditor.process("m1");
    expect(result!.status).toBe("done");
    expect(result!.resolution).toBeDefined();
    expect(result!.resolution!.action).toBe("auto_merge");
  });

  it("returns status=conflict when scalar field values differ", async () => {
    const existing = makeMemory({ id: "m1", title: "原标题" });
    const candidate = makeMemory({ id: "m1", title: "新标题" });
    const event = makeEvent("m1", candidate, ["title"]);
    const store = makeMockStore({ memory: existing, event });
    const auditor = new Auditor(store);

    const result = await auditor.process("m1");
    expect(result!.status).toBe("conflict");
    expect(result!.resolution!.action).toBe("manual_decision");
    if (result!.resolution!.action === "manual_decision") {
      expect(result!.resolution!.conflicts).toHaveLength(1);
      expect(result!.resolution!.conflicts[0].field).toBe("title");
    }
  });

  it("returns status=failed when candidate JSON is corrupted", async () => {
    const event: PendingEvent = {
      eventId: "evt-bad",
      memoryId: "m1",
      sourceType: "manual",
      candidate: "{invalid json}", // 故意损坏
      changedFields: ["title"],
      createdAt: "2026-01-01T00:00:00Z",
      status: "pending",
      retryCount: 0,
    };
    const existing = makeMemory({ id: "m1" });
    const store = makeMockStore({ memory: existing, event });
    const auditor = new Auditor(store);

    const result = await auditor.process("m1");
    expect(result!.status).toBe("failed");
    expect(result!.error).toBeTruthy();
    expect(result!.error).toContain("JSON");
  });

  it("creates a version snapshot before resolving", async () => {
    const existing = makeMemory({ id: "m1", version: 5, title: "T" });
    const candidate = makeMemory({ id: "m1", title: "T2" });
    const event = makeEvent("m1", candidate, ["title"]);
    const store = makeMockStore({ memory: existing, event });
    const auditor = new Auditor(store);

    await auditor.process("m1");

    // VersionManager 应在内存 db 中创建快照
    const snapshotRow = dbRef.current!.prepare(
      "SELECT * FROM memory_snapshots WHERE memoryId = ?",
    ).get("m1") as any;
    expect(snapshotRow).toBeTruthy();
    expect(snapshotRow.version).toBe(5);
    const snapshotData = JSON.parse(snapshotRow.data);
    expect(snapshotData.title).toBe("T"); // 快照保留的是 existing
  });

  it("mixed case: tags auto-merge + title conflict → overall conflict", async () => {
    const existing = makeMemory({ id: "m1", tags: ["a"], title: "原" });
    const candidate = makeMemory({ id: "m1", tags: ["b"], title: "新" });
    const event = makeEvent("m1", candidate, ["tags", "title"]);
    const store = makeMockStore({ memory: existing, event });
    const auditor = new Auditor(store);

    const result = await auditor.process("m1");
    expect(result!.status).toBe("conflict");
    if (result!.resolution!.action === "manual_decision") {
      // 只有 title 进入冲突列表，tags 已自动合并
      expect(result!.resolution!.conflicts).toHaveLength(1);
      expect(result!.resolution!.conflicts[0].field).toBe("title");
    }
  });

  it("multiple conflicting fields all appear in manual_decision", async () => {
    const existing = makeMemory({ id: "m1", title: "T1", content: "C1", summary: "S1" });
    const candidate = makeMemory({ id: "m1", title: "T2", content: "C2", summary: "S2" });
    const event = makeEvent("m1", candidate, ["title", "content", "summary"]);
    const store = makeMockStore({ memory: existing, event });
    const auditor = new Auditor(store);

    const result = await auditor.process("m1");
    expect(result!.status).toBe("conflict");
    if (result!.resolution!.action === "manual_decision") {
      expect(result!.resolution!.conflicts).toHaveLength(3);
    }
  });

  it("returns status=failed with reason when candidate version is older (reject)", async () => {
    const existing = makeMemory({ id: "m1", version: 10, title: "T" });
    const candidate = makeMemory({ id: "m1", version: 2, title: "T2" });
    const event = makeEvent("m1", candidate, ["title"]);
    const store = makeMockStore({ memory: existing, event });
    const auditor = new Auditor(store);

    const result = await auditor.process("m1");
    expect(result!.status).toBe("failed");
    expect(result!.resolution!.action).toBe("reject");
    if (result!.resolution!.action === "reject") {
      expect(result!.resolution!.reason).toContain("版本不兼容");
      // error 字段应透传 reject 的 reason
      expect(result!.error).toBe(result!.resolution!.reason);
    }
  });

  it("returns status=failed when candidate has corrupted data (reject)", async () => {
    const existing = makeMemory({ id: "m1" });
    // 构造损坏的 candidate：title 为空
    const candidate = { ...makeMemory({ id: "m1" }), title: "" };
    const event = makeEvent("m1", candidate, ["title"]);
    const store = makeMockStore({ memory: existing, event });
    const auditor = new Auditor(store);

    const result = await auditor.process("m1");
    expect(result!.status).toBe("failed");
    expect(result!.resolution!.action).toBe("reject");
    expect(result!.error).toContain("数据损坏");
  });
});
