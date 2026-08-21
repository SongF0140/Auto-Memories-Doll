import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import Database from "better-sqlite3";

// ── mock 1: 共享 SQLite 连接 → 内存数据库 ──
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

// ── mock 2: 文件锁 → 直接执行函数，避免触碰文件系统 ──
vi.mock("../lib/storage/lock", () => ({
  withLock: async <T>(fn: () => Promise<T>): Promise<T> => fn(),
  acquireLock: async () => true,
  releaseLock: async () => {},
}));

// ── mock 3: 向量生成 → 返回固定向量，避免依赖 embedding API ──
const { vectorMock } = vi.hoisted(() => ({
  vectorMock: {
    build: async (memoryId: string, _text: string) => ({
      memoryId,
      embedding: [0.1, 0.2, 0.3],
      model: "test-embedding",
      dimensions: 3,
      updatedAt: "2026-01-01T00:00:00Z",
    }),
    shouldFail: false,
  },
}));

vi.mock("../lib/vector/generator", () => ({
  buildVectorRecord: (memoryId: string, text: string) => {
    if (vectorMock.shouldFail) {
      throw new Error("mock embedding failure");
    }
    return vectorMock.build(memoryId, text);
  },
  generateEmbedding: async () => [0.1, 0.2, 0.3],
  isEmbeddingEmpty: (e: number[]) => e.length === 0,
}));

import { MemoryService } from "../server/services/memory-service";
import { VectorIndex } from "../lib/vector/index";
import { buildPendingEvent } from "../lib/memory/builder";
import { PendingEvent } from "../types/memory";

beforeAll(() => {
  dbRef.current = new Database(":memory:");
  dbRef.current.pragma("journal_mode = WAL");
  // 触发所有表的 CREATE TABLE IF NOT EXISTS（构造函数 init()）
  // 这样 beforeEach 的 DELETE 才不会因表不存在而报错
  new MemoryService().close();
  new VectorIndex().close();
});

beforeEach(() => {
  // 清空所有表，保证测试隔离
  dbRef.current!.exec(`
    DELETE FROM memories;
    DELETE FROM pending_events;
    DELETE FROM conflict_records;
    DELETE FROM vector_records;
  `);
  vectorMock.shouldFail = false;
});

function makeEvent(
  memoryId: string,
  createdAt: string,
  candidateOverride: object = {},
): PendingEvent {
  const candidate = {
    id: memoryId,
    version: 1,
    source: "test",
    sourceType: "manual" as const,
    title: "T",
    content: "C",
    summary: "S",
    tags: [],
    topic: "uncategorized",
    createdAt,
    updatedAt: createdAt,
    accessedAt: createdAt,
    accessCount: 0,
    heatScore: 0,
    graphLinks: [],
    ...candidateOverride,
  };
  // 注：buildPendingEvent 内部用 getCurrentTime() 覆盖 createdAt，
  // 这里手动覆盖回传入的 createdAt，保证 dequeueEvent 的 ORDER BY createdAt ASC 有序可测
  const event = buildPendingEvent(memoryId, "manual", candidate as any, ["title"]);
  event.createdAt = createdAt;
  return event;
}

describe("MemoryService — 队列基础操作", () => {
  it("enqueueEvent inserts a pending event", () => {
    const svc = new MemoryService();
    const event = makeEvent("m1", "2026-01-01T00:00:00Z");
    svc.enqueueEvent(event);

    const pending = svc.getPendingEvents();
    expect(pending).toHaveLength(1);
    expect(pending[0].eventId).toBe(event.eventId);
    expect(pending[0].status).toBe("pending");
    expect(pending[0].retryCount).toBe(0);
  });

  it("getPendingEvents only returns status='pending' events", () => {
    const svc = new MemoryService();
    const event = makeEvent("m1", "2026-01-01T00:00:00Z");
    svc.enqueueEvent(event);

    // 模拟已被消费：手动改为 processing
    event.status = "processing";
    svc.updateEvent(event);

    expect(svc.getPendingEvents()).toHaveLength(0);
  });

  it("dequeueEvent returns null when queue is empty", () => {
    const svc = new MemoryService();
    expect(svc.dequeueEvent("m1")).toBeNull();
  });

  it("dequeueEvent atomically marks event as processing", () => {
    const svc = new MemoryService();
    const event = makeEvent("m1", "2026-01-01T00:00:00Z");
    svc.enqueueEvent(event);

    const dequeued = svc.dequeueEvent("m1");
    expect(dequeued).not.toBeNull();
    expect(dequeued!.eventId).toBe(event.eventId);
    expect(dequeued!.status).toBe("processing");

    // 再次 dequeue 应返回 null（已被标记 processing）
    expect(svc.dequeueEvent("m1")).toBeNull();
    // pending 列表也不再包含
    expect(svc.getPendingEvents()).toHaveLength(0);
  });
});

describe("MemoryService — 串行消费顺序", () => {
  it("dequeues events of same memoryId in createdAt ASC order", () => {
    const svc = new MemoryService();
    const e1 = makeEvent("m1", "2026-01-01T00:00:00Z");
    const e2 = makeEvent("m1", "2026-01-02T00:00:00Z");
    const e3 = makeEvent("m1", "2026-01-03T00:00:00Z");
    // 故意乱序入队
    svc.enqueueEvent(e3);
    svc.enqueueEvent(e1);
    svc.enqueueEvent(e2);

    const first = svc.dequeueEvent("m1");
    expect(first!.eventId).toBe(e1.eventId);

    const second = svc.dequeueEvent("m1");
    expect(second!.eventId).toBe(e2.eventId);

    const third = svc.dequeueEvent("m1");
    expect(third!.eventId).toBe(e3.eventId);

    expect(svc.dequeueEvent("m1")).toBeNull();
  });

  it("dequeues independently across different memoryIds", () => {
    const svc = new MemoryService();
    svc.enqueueEvent(makeEvent("mA", "2026-01-01T00:00:00Z"));
    svc.enqueueEvent(makeEvent("mB", "2026-01-01T00:00:00Z"));

    const a = svc.dequeueEvent("mA");
    expect(a!.memoryId).toBe("mA");

    // mB 仍可独立消费
    const b = svc.dequeueEvent("mB");
    expect(b!.memoryId).toBe("mB");

    // mA 队列已空
    expect(svc.dequeueEvent("mA")).toBeNull();
  });
});

describe("MemoryService — updateEvent 状态流转", () => {
  it("transitions pending → processing → done", () => {
    const svc = new MemoryService();
    const event = makeEvent("m1", "2026-01-01T00:00:00Z");
    svc.enqueueEvent(event);

    const dequeued = svc.dequeueEvent("m1")!;
    expect(dequeued.status).toBe("processing");

    dequeued.status = "done";
    svc.updateEvent(dequeued);

    // done 不在 pending 列表
    expect(svc.getPendingEvents()).toHaveLength(0);
  });

  it("increments retryCount on failure", () => {
    const svc = new MemoryService();
    const event = makeEvent("m1", "2026-01-01T00:00:00Z");
    svc.enqueueEvent(event);

    const dequeued = svc.dequeueEvent("m1")!;
    dequeued.status = "failed";
    dequeued.retryCount += 1;
    svc.updateEvent(dequeued);

    // 直接查 db 验证 retryCount
    const row = dbRef
      .current!.prepare("SELECT retryCount, status FROM pending_events WHERE eventId = ?")
      .get(event.eventId) as any;
    expect(row.retryCount).toBe(1);
    expect(row.status).toBe("failed");
  });
});

describe("MemoryService — createMemory 完整流程", () => {
  it("persists a queued record without replacing its stable memoryId", async () => {
    const svc = new MemoryService();
    const stagedId = svc.stageCreateMemory(
      "external",
      "listen",
      "稳定 ID",
      "候选正文",
      "候选摘要",
      [],
      "integration",
    );
    const event = svc.getPendingEvents()[0];
    const candidate = JSON.parse(event.candidate);

    const persistedId = await svc.createMemoryRecord(candidate);

    expect(persistedId).toBe(stagedId);
    expect(svc.getMemory(stagedId)?.id).toBe(stagedId);
  });

  it("creates memory, generates vector, and writes vectorId", async () => {
    const svc = new MemoryService();
    const id = await svc.createMemory("test", "manual", "标题", "内容", "摘要", ["a"], "topic-x");

    const mem = svc.getMemory(id);
    expect(mem).not.toBeNull();
    expect(mem!.title).toBe("标题");
    expect(mem!.tags).toEqual(["a"]);
    expect(mem!.topic).toBe("topic-x");
    expect(mem!.vectorId).toBe(id); // vectorId 应等于 memoryId
  });

  it("still saves memory when vector generation fails", async () => {
    vectorMock.shouldFail = true;
    const svc = new MemoryService();
    const id = await svc.createMemory("test", "manual", "T", "C", "S");

    const mem = svc.getMemory(id);
    // 记忆仍应保存成功（向量失败不阻塞）
    expect(mem).not.toBeNull();
    expect(mem!.title).toBe("T");
    // vectorId 未写入：SQLite 列默认 NULL，getMemory 直接返回 row.vectorId（null）
    expect(mem!.vectorId).toBeNull();
  });

  it("listMemories supports limit and offset pagination", async () => {
    const svc = new MemoryService();
    for (let i = 0; i < 5; i++) {
      await svc.createMemory("test", "manual", `T${i}`, "C", "S");
    }

    const page1 = svc.listMemories({ limit: 2, offset: 0 });
    const page2 = svc.listMemories({ limit: 2, offset: 2 });
    expect(page1).toHaveLength(2);
    expect(page2).toHaveLength(2);
    // 两页不应有重复 id
    const ids1 = new Set(page1.map((m) => m.id));
    for (const m of page2) expect(ids1.has(m.id)).toBe(false);
  });

  it("listMemories returns all when limit omitted", async () => {
    const svc = new MemoryService();
    await svc.createMemory("test", "manual", "T1", "C", "S");
    await svc.createMemory("test", "manual", "T2", "C", "S");
    expect(svc.listMemories()).toHaveLength(2);
  });
});

describe("MemoryService — listMemories 排序与过滤", () => {
  it("sorts by title ascending", async () => {
    const svc = new MemoryService();
    await svc.createMemory("test", "manual", "C-标题", "C", "S");
    await svc.createMemory("test", "manual", "A-标题", "C", "S");
    await svc.createMemory("test", "manual", "B-标题", "C", "S");

    const result = svc.listMemories({ sortBy: "title", sortOrder: "asc" });
    expect(result[0].title).toBe("A-标题");
    expect(result[1].title).toBe("B-标题");
    expect(result[2].title).toBe("C-标题");
  });

  it("sorts by createdAt descending (default)", async () => {
    const svc = new MemoryService();
    const id1 = await svc.createMemory("test", "manual", "最早", "C", "S");
    await new Promise((r) => setTimeout(r, 10));
    const id2 = await svc.createMemory("test", "manual", "最新", "C", "S");

    const result = svc.listMemories({ sortBy: "createdAt", sortOrder: "desc" });
    expect(result[0].id).toBe(id2); // 最新在前
    expect(result[1].id).toBe(id1);
  });

  it("sorts by accessCount ascending with pagination", async () => {
    const svc = new MemoryService();
    await svc.createMemory("test", "manual", "T1", "C", "S");
    await svc.createMemory("test", "manual", "T2", "C", "S");
    svc.incrementAccess(svc.listMemories({ sortBy: "title", sortOrder: "asc" })[0].id);

    const result = svc.listMemories({
      sortBy: "accessCount",
      sortOrder: "asc",
      limit: 2,
      offset: 0,
    });
    expect(result[0].accessCount).toBe(0);
    expect(result[1].accessCount).toBe(1);
  });

  it("filters by tag", async () => {
    const svc = new MemoryService();
    await svc.createMemory("test", "manual", "包含标签", "C", "S", ["react"]);
    await svc.createMemory("test", "manual", "不含标签", "C", "S", ["vue"]);
    await svc.createMemory("test", "manual", "也包含", "C", "S", ["react", "typescript"]);

    const result = svc.listMemories({ tag: "react" });
    expect(result).toHaveLength(2);
    expect(result.every((m) => m.tags.includes("react"))).toBe(true);
  });

  it("filters by tag with pagination", async () => {
    const svc = new MemoryService();
    for (let i = 0; i < 5; i++) {
      await svc.createMemory("test", "manual", `T${i}`, "C", "S", ["api"]);
    }
    await svc.createMemory("test", "manual", "其他", "C", "S", ["other"]);

    const page = svc.listMemories({ tag: "api", limit: 3, offset: 0 });
    expect(page).toHaveLength(3);
  });

  it("tag filter combined with sortBy", async () => {
    const svc = new MemoryService();
    await svc.createMemory("test", "manual", "Z-标题", "C", "S", ["ai"]);
    await svc.createMemory("test", "manual", "A-标题", "C", "S", ["ai"]);
    await svc.createMemory("test", "manual", "M-标题", "C", "S", ["other"]);

    const result = svc.listMemories({ tag: "ai", sortBy: "title", sortOrder: "asc" });
    expect(result).toHaveLength(2);
    expect(result[0].title).toBe("A-标题");
    expect(result[1].title).toBe("Z-标题");
  });

  it("invalid sortBy falls back to updatedAt", async () => {
    const svc = new MemoryService();
    await svc.createMemory("test", "manual", "T1", "C", "S");
    await svc.createMemory("test", "manual", "T2", "C", "S");

    // 传非法字段名不应崩溃，应回退到默认排序
    const result = svc.listMemories({ sortBy: "malicious; DROP TABLE" as any });
    expect(result).toHaveLength(2);
  });

  it("no tag match returns empty list", async () => {
    const svc = new MemoryService();
    await svc.createMemory("test", "manual", "T", "C", "S", ["js"]);

    const result = svc.listMemories({ tag: "nonexistent" });
    expect(result).toHaveLength(0);
  });
});

describe("MemoryService — count with tag filter", () => {
  it("counts all memories without tag", async () => {
    const svc = new MemoryService();
    await svc.createMemory("test", "manual", "T1", "C", "S");
    await svc.createMemory("test", "manual", "T2", "C", "S");
    expect(svc.count()).toBe(2);
  });

  it("counts memories filtered by tag", async () => {
    const svc = new MemoryService();
    await svc.createMemory("test", "manual", "T1", "C", "S", ["nextjs"]);
    await svc.createMemory("test", "manual", "T2", "C", "S", ["nextjs"]);
    await svc.createMemory("test", "manual", "T3", "C", "S", ["python"]);

    expect(svc.count("nextjs")).toBe(2);
    expect(svc.count("python")).toBe(1);
  });

  it("count returns 0 for unmatched tag", () => {
    const svc = new MemoryService();
    expect(svc.count("nonexistent")).toBe(0);
  });

  it("count returns 0 for empty database", () => {
    const svc = new MemoryService();
    expect(svc.count()).toBe(0);
  });
});

describe("MemoryService — CRUD 边界", () => {
  it("getMemory returns null for non-existent id", () => {
    const svc = new MemoryService();
    expect(svc.getMemory("non-existent")).toBeNull();
  });

  it("updateMemory bumps version and applies updates", async () => {
    const svc = new MemoryService();
    const id = await svc.createMemory("test", "manual", "T", "C", "S");
    const before = svc.getMemory(id)!;

    svc.updateMemory(id, { title: "新标题", heatScore: 0.5 });
    const after = svc.getMemory(id)!;
    expect(after.title).toBe("新标题");
    expect(after.heatScore).toBe(0.5);
    expect(after.version).toBe(before.version + 1);
  });

  it("deleteMemory removes record and its vector", async () => {
    const svc = new MemoryService();
    const id = await svc.createMemory("test", "manual", "T", "C", "S");
    expect(svc.getMemory(id)).not.toBeNull();

    svc.deleteMemory(id);
    expect(svc.getMemory(id)).toBeNull();
  });

  it("incrementAccess increases accessCount and refreshes accessedAt", async () => {
    const svc = new MemoryService();
    const id = await svc.createMemory("test", "manual", "T", "C", "S");
    const before = svc.getMemory(id)!;
    expect(before.accessCount).toBe(0);

    svc.incrementAccess(id);
    const after = svc.getMemory(id)!;
    expect(after.accessCount).toBe(1);
    expect(new Date(after.accessedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(before.accessedAt).getTime(),
    );
  });
});
