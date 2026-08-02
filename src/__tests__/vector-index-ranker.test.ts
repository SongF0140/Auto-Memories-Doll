import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import Database from "better-sqlite3";

// ── mock 共享 SQLite 连接为内存数据库，避免触碰文件系统 ──
// vi.hoisted 让 mock 工厂能在 hoist 阶段拿到 db 引用
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

import { VectorIndex } from "../lib/vector/index";
import { Ranker } from "../lib/vector/ranker";
import { MemoryRecord } from "../types/memory";

beforeAll(() => {
  dbRef.current = new Database(":memory:");
  dbRef.current.pragma("journal_mode = WAL");
  // 触发 vector_records 表的 CREATE TABLE IF NOT EXISTS
  new VectorIndex().close();
});

function makeMemory(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id: "mem-1",
    version: 1,
    source: "test",
    sourceType: "manual",
    title: "t",
    content: "c",
    summary: "s",
    tags: [],
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

describe("VectorIndex", () => {
  let index: VectorIndex;

  beforeEach(() => {
    // 每个测试前清空表，保证隔离
    dbRef.current!.exec("DELETE FROM vector_records");
    index = new VectorIndex();
  });

  it("creates and reads a vector record", () => {
    index.create({
      memoryId: "m1",
      embedding: [1, 0, 0],
      model: "test-model",
      dimensions: 3,
      updatedAt: "2026-01-01",
    });
    const record = index.read("m1");
    expect(record).not.toBeNull();
    expect(record!.embedding).toEqual([1, 0, 0]);
    expect(record!.model).toBe("test-model");
    expect(record!.dimensions).toBe(3);
  });

  it("upserts on create (INSERT OR REPLACE)", () => {
    index.create({ memoryId: "m1", embedding: [1, 0], model: "m", dimensions: 2, updatedAt: "t1" });
    index.create({ memoryId: "m1", embedding: [0, 1], model: "m", dimensions: 2, updatedAt: "t2" });
    const record = index.read("m1");
    expect(record!.embedding).toEqual([0, 1]);
    expect(record!.updatedAt).toBe("t2");
  });

  it("deletes a vector record", () => {
    index.create({ memoryId: "m1", embedding: [1, 0], model: "m", dimensions: 2, updatedAt: "t" });
    index.delete("m1");
    expect(index.read("m1")).toBeNull();
  });

  it("update delegates to create (upsert semantics)", () => {
    index.update({ memoryId: "m1", embedding: [1, 1], model: "m", dimensions: 2, updatedAt: "t" });
    expect(index.read("m1")!.embedding).toEqual([1, 1]);
  });

  it("search returns empty for empty index", () => {
    const results = index.search([1, 0, 0], 5);
    expect(results).toEqual([]);
  });

  it("search ranks by cosine similarity descending", () => {
    index.create({ memoryId: "m1", embedding: [1, 0, 0], model: "m", dimensions: 3, updatedAt: "t" });
    index.create({ memoryId: "m2", embedding: [0, 1, 0], model: "m", dimensions: 3, updatedAt: "t" });
    index.create({ memoryId: "m3", embedding: [0.7071, 0.7071, 0], model: "m", dimensions: 3, updatedAt: "t" });

    const results = index.search([1, 0, 0], 3);
    expect(results[0].memoryId).toBe("m1"); // 完全相同，similarity ≈ 1
    expect(results[1].memoryId).toBe("m3"); // 45度角，similarity ≈ 0.707
    expect(results[2].memoryId).toBe("m2"); // 正交，similarity = 0
    expect(results[0].similarity).toBeGreaterThan(results[1].similarity);
    expect(results[1].similarity).toBeGreaterThan(results[2].similarity);
  });

  it("search respects limit parameter", () => {
    index.create({ memoryId: "m1", embedding: [1, 0], model: "m", dimensions: 2, updatedAt: "t" });
    index.create({ memoryId: "m2", embedding: [0.9, 0.1], model: "m", dimensions: 2, updatedAt: "t" });
    index.create({ memoryId: "m3", embedding: [0.8, 0.2], model: "m", dimensions: 2, updatedAt: "t" });

    const results = index.search([1, 0], 2);
    expect(results).toHaveLength(2);
  });

  it("list returns all records", () => {
    index.create({ memoryId: "m1", embedding: [1, 0], model: "m", dimensions: 2, updatedAt: "t" });
    index.create({ memoryId: "m2", embedding: [0, 1], model: "m", dimensions: 2, updatedAt: "t" });
    expect(index.list()).toHaveLength(2);
  });
});

describe("Ranker", () => {
  it("returns empty for empty candidates", () => {
    const ranker = new Ranker();
    expect(ranker.rank([], new Map(), [])).toEqual([]);
  });

  it("skips candidates whose memory is missing from the map", () => {
    const ranker = new Ranker();
    const mem = makeMemory({ id: "m1" });
    const memories = new Map([["m1", mem]]);
    // m2 不在 map 中，应被过滤
    const results = ranker.rank(
      [
        { memoryId: "m1", similarity: 0.9 },
        { memoryId: "m2", similarity: 0.8 },
      ],
      memories,
      [],
    );
    expect(results).toHaveLength(1);
    expect(results[0].memoryId).toBe("m1");
  });

  it("computes recencyScore with half-life ~69h (λ=0.01)", () => {
    const ranker = new Ranker();
    const now = Date.now();
    // 69 小时前更新 → recencyScore ≈ exp(-0.01 * 69) ≈ 0.5
    const hoursAgo69 = new Date(now - 69 * 3600 * 1000).toISOString();
    const mem = makeMemory({ id: "m1", updatedAt: hoursAgo69, accessCount: 0, tags: [] });
    const memories = new Map([["m1", mem]]);

    const results = ranker.rank([{ memoryId: "m1", similarity: 0.5 }], memories, []);
    const recency = results[0].factors.recency;
    // 半衰期约 69.3 小时，recency 应在 0.5 附近（容差 0.05）
    expect(recency).toBeGreaterThan(0.45);
    expect(recency).toBeLessThan(0.55);
  });

  it("computes accessScore as ln(1+n)/ln(1+max)", () => {
    const ranker = new Ranker();
    const mem1 = makeMemory({ id: "m1", accessCount: 0 });
    const mem2 = makeMemory({ id: "m2", accessCount: 100 });
    const memories = new Map([
      ["m1", mem1],
      ["m2", mem2],
    ]);

    const results = ranker.rank(
      [
        { memoryId: "m1", similarity: 0.5 },
        { memoryId: "m2", similarity: 0.5 },
      ],
      memories,
      [],
    );
    // max=100，m1 accessCount=0 → accessScore = ln(1)/ln(101) = 0
    // m2 accessCount=100 → accessScore = ln(101)/ln(101) = 1
    const m1Result = results.find((r) => r.memoryId === "m1")!;
    const m2Result = results.find((r) => r.memoryId === "m2")!;
    expect(m1Result.factors.access).toBe(0);
    expect(m2Result.factors.access).toBeCloseTo(1, 5);
  });

  it("computes tagAffinityScore via Jaccard similarity", () => {
    const ranker = new Ranker();
    const mem = makeMemory({ id: "m1", tags: ["a", "b", "c"] });
    const memories = new Map([["m1", mem]]);
    const profileTags = ["b", "c", "d"]; // 交集 {b,c}=2，并集 {a,b,c,d}=4 → 0.5

    const results = ranker.rank([{ memoryId: "m1", similarity: 0.5 }], memories, profileTags);
    expect(results[0].factors.tagAffinity).toBeCloseTo(0.5, 5);
  });

  it("tagAffinity is 0 when profile has no tags", () => {
    const ranker = new Ranker();
    const mem = makeMemory({ id: "m1", tags: ["a"] });
    const memories = new Map([["m1", mem]]);
    const results = ranker.rank([{ memoryId: "m1", similarity: 0.5 }], memories, []);
    expect(results[0].factors.tagAffinity).toBe(0);
  });

  it("weighted sum: 0.4*relevance + 0.25*heat + 0.2*recency + 0.1*access + 0.05*tag", () => {
    const ranker = new Ranker();
    const mem = makeMemory({
      id: "m1",
      accessCount: 10,
      heatScore: 0.6,
      tags: ["a", "b"],
      updatedAt: new Date().toISOString(),
    });
    const memories = new Map([["m1", mem]]);

    const results = ranker.rank([{ memoryId: "m1", similarity: 0.8 }], memories, ["a"]);
    const r = results[0];
    const expected =
      0.8 * 0.4 +
      0.6 * 0.25 +
      r.factors.recency * 0.2 + // recency ≈ 1（刚刚更新）
      r.factors.access * 0.1 +
      r.factors.tagAffinity * 0.05;
    expect(r.score).toBeCloseTo(expected, 5);
  });

  it("sorts results by score descending", () => {
    const ranker = new Ranker();
    const mem1 = makeMemory({ id: "m1", heatScore: 0.1 });
    const mem2 = makeMemory({ id: "m2", heatScore: 0.9 });
    const memories = new Map([
      ["m1", mem1],
      ["m2", mem2],
    ]);

    const results = ranker.rank(
      [
        { memoryId: "m1", similarity: 0.5 },
        { memoryId: "m2", similarity: 0.5 },
      ],
      memories,
      [],
    );
    expect(results[0].memoryId).toBe("m2"); // heatScore 高的排前面
    expect(results[1].memoryId).toBe("m1");
  });

  it("preserves originalScore from similarity", () => {
    const ranker = new Ranker();
    const mem = makeMemory({ id: "m1" });
    const memories = new Map([["m1", mem]]);
    const results = ranker.rank([{ memoryId: "m1", similarity: 0.77 }], memories, []);
    expect(results[0].originalScore).toBe(0.77);
    expect(results[0].factors.relevance).toBe(0.77);
  });
});

describe("Ranker.rankWithMMR", () => {
  it("returns empty for empty candidates", () => {
    const ranker = new Ranker();
    expect(ranker.rankWithMMR([], new Map(), [])).toEqual([]);
  });

  it("returns single candidate directly (no diversity penalty)", () => {
    const ranker = new Ranker();
    const mem = makeMemory({ id: "m1", heatScore: 0.5 });
    const memories = new Map([["m1", mem]]);
    const results = ranker.rankWithMMR([{ memoryId: "m1", similarity: 0.8 }], memories, []);
    expect(results).toHaveLength(1);
    expect(results[0].memoryId).toBe("m1");
    // 单候选时 score 应等于基础分数（无多样性惩罚）
    expect(results[0].score).toBeGreaterThan(0);
  });

  it("selects highest base score first", () => {
    const ranker = new Ranker();
    const mem1 = makeMemory({ id: "m1", heatScore: 0.1 });
    const mem2 = makeMemory({ id: "m2", heatScore: 0.9 });
    const memories = new Map([
      ["m1", mem1],
      ["m2", mem2],
    ]);

    const results = ranker.rankWithMMR(
      [
        { memoryId: "m1", similarity: 0.5 },
        { memoryId: "m2", similarity: 0.5 },
      ],
      memories,
      [],
    );
    // 首轮选基础分数最高的 m2（heatScore 0.9 > 0.1）
    expect(results[0].memoryId).toBe("m2");
  });

  it("penalizes candidates with identical tags (high doc-doc similarity)", () => {
    const ranker = new Ranker();
    // 两条记忆 tags 完全相同 → Jaccard=1 → 第二条受最大多样性惩罚
    const mem1 = makeMemory({ id: "m1", heatScore: 0.5, tags: ["a", "b"] });
    const mem2 = makeMemory({ id: "m2", heatScore: 0.5, tags: ["a", "b"] });
    // 第三条 tags 完全不同 → Jaccard=0 → 不受惩罚
    const mem3 = makeMemory({ id: "m3", heatScore: 0.4, tags: ["x", "y"] });
    const memories = new Map([
      ["m1", mem1],
      ["m2", mem2],
      ["m3", mem3],
    ]);

    const results = ranker.rankWithMMR(
      [
        { memoryId: "m1", similarity: 0.5 },
        { memoryId: "m2", similarity: 0.5 },
        { memoryId: "m3", similarity: 0.5 },
      ],
      memories,
      [],
    );

    // 首轮：m1 和 m2 基础分数相同（heat=0.5），选 m1
    expect(results[0].memoryId).toBe("m1");
    // 第二轮：m2 与 m1 tags 完全相同（Jaccard=1），受多样性惩罚；
    // m3 tags 完全不同（Jaccard=0），不受惩罚。即使 m3 基础分数略低（heat=0.4），
    // 在 α=0.7 下 m3 的 MMR 仍可能高于 m2
    // 验证：m2 的 MMR = 0.7*score_m2 - 0.3*1，m3 的 MMR = 0.7*score_m3 - 0.3*0
    // score_m2 ≈ 0.5*0.4 + 0.5*0.25 + 1*0.2 + 0*0.1 + 0*0.05 = 0.425
    // score_m3 ≈ 0.5*0.4 + 0.4*0.25 + 1*0.2 + 0*0.1 + 0*0.05 = 0.4
    // m2_MMR = 0.7*0.425 - 0.3*1 = 0.2975 - 0.3 = -0.0025
    // m3_MMR = 0.7*0.4 - 0.3*0 = 0.28
    // 所以 m3 应排在 m2 前面
    expect(results[1].memoryId).toBe("m3");
    expect(results[2].memoryId).toBe("m2");
  });

  it("alpha=1 degrades to pure relevance ranking (no diversity penalty)", () => {
    const ranker = new Ranker();
    const mem1 = makeMemory({ id: "m1", heatScore: 0.5, tags: ["a"] });
    const mem2 = makeMemory({ id: "m2", heatScore: 0.4, tags: ["a"] });
    const memories = new Map([
      ["m1", mem1],
      ["m2", mem2],
    ]);

    const results = ranker.rankWithMMR(
      [
        { memoryId: "m1", similarity: 0.5 },
        { memoryId: "m2", similarity: 0.5 },
      ],
      memories,
      [],
      { alpha: 1 },
    );

    // α=1 时无多样性惩罚，应按基础分数排序：m1(heat=0.5) > m2(heat=0.4)
    expect(results[0].memoryId).toBe("m1");
    expect(results[1].memoryId).toBe("m2");
  });

  it("alpha=0 prioritizes pure diversity (maximally different first)", () => {
    const ranker = new Ranker();
    // 两条记忆 tags 完全相同，但 m2 基础分数更高
    const mem1 = makeMemory({ id: "m1", heatScore: 0.3, tags: ["a"] });
    const mem2 = makeMemory({ id: "m2", heatScore: 0.9, tags: ["a"] });
    const mem3 = makeMemory({ id: "m3", heatScore: 0.3, tags: ["z"] });
    const memories = new Map([
      ["m1", mem1],
      ["m2", mem2],
      ["m3", mem3],
    ]);

    const results = ranker.rankWithMMR(
      [
        { memoryId: "m1", similarity: 0.5 },
        { memoryId: "m2", similarity: 0.5 },
        { memoryId: "m3", similarity: 0.5 },
      ],
      memories,
      [],
      { alpha: 0 },
    );

    // α=0 时首轮仍选基础分数最高（m2, heat=0.9）
    expect(results[0].memoryId).toBe("m2");
    // 第二轮：m1 与 m2 tags 相同（Jaccard=1），m3 与 m2 tags 完全不同（Jaccard=0）
    // α=0 时 MMR = -max_sim，m1 的 MMR = -1，m3 的 MMR = 0
    // 所以 m3 排在 m1 前面
    expect(results[1].memoryId).toBe("m3");
    expect(results[2].memoryId).toBe("m1");
  });

  it("returns all candidates (no loss of results)", () => {
    const ranker = new Ranker();
    const memories = new Map([
      ["m1", makeMemory({ id: "m1", tags: ["a"] })],
      ["m2", makeMemory({ id: "m2", tags: ["b"] })],
      ["m3", makeMemory({ id: "m3", tags: ["c"] })],
      ["m4", makeMemory({ id: "m4", tags: ["d"] })],
    ]);

    const results = ranker.rankWithMMR(
      [
        { memoryId: "m1", similarity: 0.5 },
        { memoryId: "m2", similarity: 0.4 },
        { memoryId: "m3", similarity: 0.3 },
        { memoryId: "m4", similarity: 0.2 },
      ],
      memories,
      [],
    );

    // MMR 是重排，不丢弃候选
    expect(results).toHaveLength(4);
    // 所有 memoryId 都应出现
    const ids = new Set(results.map((r) => r.memoryId));
    expect(ids.size).toBe(4);
  });
});
