/**
 * 实体层测试（对标 Hindsight entity 抽取 + causal link）
 *
 * 覆盖三段链路：
 * 1. 抽取解析：entities / causedBy 字段的容错解析（缺失不炸、非法值过滤）
 * 2. 存储：实体字典大小写合并、共现邻居排序、caused_by 双向扩展、删除级联
 * 3. 检索：multi-hop 路由把实体/因果邻居并入 RRF 融合
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";

// ── 共享 SQLite 连接 → 内存数据库（memory-service / entity-index / route-stats 共用）──
const { dbRef, adapterMock } = vi.hoisted(() => ({
  dbRef: { current: null as Database.Database | null },
  adapterMock: { response: "" },
}));

vi.mock("../lib/storage/database", () => ({
  getDatabase: () => dbRef.current,
  closeDatabase: () => {
    if (dbRef.current) {
      dbRef.current.close();
      dbRef.current = null;
    }
  },
}));

vi.mock("../lib/storage/lock", () => ({
  withLock: async <T>(fn: () => Promise<T>): Promise<T> => fn(),
  acquireLock: async () => true,
  releaseLock: async () => {},
}));

vi.mock("../lib/vector/generator", () => ({
  buildVectorRecord: async (memoryId: string, _text: string) => ({
    memoryId,
    embedding: [0.1, 0.2, 0.3],
    model: "test-embedding",
    dimensions: 3,
    updatedAt: "2026-01-01T00:00:00Z",
  }),
  buildEmbeddingKey: (input: { summary?: string; windowUse?: string; content?: string }) =>
    input.summary ?? input.content ?? "",
  generateEmbedding: async (_text: string) => [1, 0],
  isEmbeddingEmpty: (e: number[]) => e.length === 0,
}));

vi.mock("../lib/ai/model-adapter", () => ({
  ModelAdapter: {
    isDegradedMode: false,
    generate: async () => ({ content: adapterMock.response }),
  },
}));

const { vectorIndexMock } = vi.hoisted(() => ({
  vectorIndexMock: {
    search: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
    close: vi.fn(),
    getBackendName: vi.fn(() => "js-exact"),
  },
}));

vi.mock("../lib/vector/index", () => ({
  VectorIndex: vi.fn(() => vectorIndexMock),
}));

import { MemoryService } from "../server/services/memory-service";
import { MemoryExtractionService } from "../server/services/memory-extraction-service";
import { EntityIndex } from "../lib/graph/entity-index";
import { VectorRetriever } from "../lib/vector/retriever";
import { MemoryRecord } from "../types/memory";

beforeAll(() => {
  dbRef.current = new Database(":memory:");
  dbRef.current.pragma("journal_mode = WAL");
  new MemoryService().close();
});

beforeEach(() => {
  dbRef.current!.exec(`
    DELETE FROM memories;
    DELETE FROM pending_events;
    DELETE FROM conflict_records;
    DELETE FROM entities;
    DELETE FROM memory_entities;
    DELETE FROM memory_relations;
  `);
  adapterMock.response = "";
  vectorIndexMock.search.mockReset();
});

// ── 1. 抽取解析 ──

function makeCandidate(): MemoryRecord {
  return {
    id: "cand-1",
    version: 1,
    source: "test",
    sourceType: "ingest",
    title: "原始标题",
    content: "原始内容，长度不足以触发待复核标记。",
    summary: "",
    tags: [],
    topic: "uncategorized",
    createdAt: "2026-09-25T00:00:00.000Z",
    updatedAt: "2026-09-25T00:00:00.000Z",
    accessedAt: null,
    accessCount: 0,
    heatScore: 0,
  } as unknown as MemoryRecord;
}

describe("MemoryExtractionService 实体/因果字段解析", () => {
  const svc = new MemoryExtractionService();

  it("解析 entities 与 causedBy，过滤非法值", async () => {
    adapterMock.response = JSON.stringify({
      memories: [
        {
          title: "标题一",
          summary: "摘要一",
          content: "正文一",
          tags: ["t"],
          entities: ["Claude Code", " claude code ", "", 123, "x".repeat(61), "better-sqlite3"],
          causedBy: [2, 2, 0, 9, "3", 1.5],
        },
        { title: "标题二", summary: "摘要二", content: "正文二", tags: [] },
      ],
    });
    const cards = await svc.extract(makeCandidate(), []);
    expect(cards).not.toBeNull();
    expect(cards![0].entities).toEqual(["Claude Code", "claude code", "better-sqlite3"]);
    // 0 与 9 越界丢弃；重复的 2 去重；"3" 字符串转数字；1.5 非整数丢弃
    expect(cards![0].causedBy).toEqual([2, 3]);
  });

  it("旧格式输出（无 entities/causedBy）容错为空数组", async () => {
    adapterMock.response = JSON.stringify({
      memories: [{ title: "标题", summary: "摘要", content: "正文", tags: ["t"] }],
    });
    const cards = await svc.extract(makeCandidate(), []);
    expect(cards).not.toBeNull();
    expect(cards![0].entities).toEqual([]);
    expect(cards![0].causedBy).toEqual([]);
  });

  it("entities 超过 8 个时截断", async () => {
    adapterMock.response = JSON.stringify({
      memories: [
        {
          title: "标题",
          summary: "摘要",
          content: "正文",
          tags: [],
          entities: Array.from({ length: 12 }, (_, i) => `实体${i}`),
        },
      ],
    });
    const cards = await svc.extract(makeCandidate(), []);
    expect(cards![0].entities).toHaveLength(8);
  });

  it("causedByExisting 引用相似条目编号，越界过滤", async () => {
    adapterMock.response = JSON.stringify({
      memories: [
        {
          title: "标题",
          summary: "摘要",
          content: "正文",
          tags: [],
          causedByExisting: [1, 3, "2", 0, 99, 2.5],
        },
      ],
    });
    // 2 条 hints：编号 3 越界丢弃，"2" 字符串转数字，0/99/2.5 非法丢弃
    const cards = await svc.extract(makeCandidate(), [
      { memoryId: "old-1", title: "旧卡一", summary: "s", similarity: 0.5 },
      { memoryId: "old-2", title: "旧卡二", summary: "s", similarity: 0.4 },
    ]);
    expect(cards![0].causedByExisting).toEqual([1, 2]);
  });

  it("causedByExisting 上限随 hints 数量收缩：无 hints 时恒为空", async () => {
    adapterMock.response = JSON.stringify({
      memories: [{ title: "标题", summary: "摘要", content: "正文", tags: [], causedByExisting: [1] }],
    });
    const cards = await svc.extract(makeCandidate(), []);
    expect(cards![0].causedByExisting).toEqual([]);
  });
});

// ── 2. 存储层 ──

describe("MemoryService 实体与因果边", () => {
  let svc: MemoryService;
  let m1: string;
  let m2: string;
  let m3: string;

  beforeEach(async () => {
    svc = new MemoryService();
    m1 = await svc.createMemory("test", "manual", "卡一", "内容一", "摘要一");
    m2 = await svc.createMemory("test", "manual", "卡二", "内容二", "摘要二");
    m3 = await svc.createMemory("test", "manual", "卡三", "内容三", "摘要三");
  });

  it("实体按 normalizedName 合并：大小写不同写法同一实体", () => {
    svc.setMemoryEntities(m1, ["Claude Code", "better-sqlite3"]);
    svc.setMemoryEntities(m2, ["claude code"]);

    const count = dbRef.current!
      .prepare("SELECT COUNT(*) AS n FROM entities")
      .get() as { n: number };
    expect(count.n).toBe(2);

    expect(svc.getMemoryEntities(m1)).toEqual(["Claude Code", "better-sqlite3"]);
    expect(svc.getMemoryEntities(m2)).toEqual(["Claude Code"]); // 首次出现的写法
  });

  it("setMemoryEntities 幂等替换：重写后不残留旧关联", () => {
    svc.setMemoryEntities(m1, ["旧实体"]);
    svc.setMemoryEntities(m1, ["新实体"]);
    expect(svc.getMemoryEntities(m1)).toEqual(["新实体"]);
    // 旧实体成为孤儿（仅 deleteMemory 时回收），但 m1 不再引用它
    const linked = dbRef.current!
      .prepare("SELECT COUNT(*) AS n FROM memory_entities WHERE memoryId = ?")
      .get(m1) as { n: number };
    expect(linked.n).toBe(1);
  });

  it("共现邻居按共享实体数降序，排除种子自身", () => {
    svc.setMemoryEntities(m1, ["A", "B"]);
    svc.setMemoryEntities(m2, ["A"]);
    svc.setMemoryEntities(m3, ["A", "B"]);

    const neighbors = svc.getEntityNeighbors([m1]);
    expect(neighbors[0]).toEqual({ memoryId: m3, sharedEntities: 2 });
    expect(neighbors.find((n) => n.memoryId === m2)?.sharedEntities).toBe(1);
    expect(neighbors.find((n) => n.memoryId === m1)).toBeUndefined();
  });

  it("已取代（superseded）卡片不进入共现邻居", async () => {
    svc.setMemoryEntities(m1, ["A"]);
    svc.setMemoryEntities(m2, ["A"]);
    dbRef.current!.prepare("UPDATE memories SET status = 'superseded' WHERE id = ?").run(m2);
    expect(svc.getEntityNeighbors([m1])).toEqual([]);
  });

  it("caused_by 双向扩展且幂等重建，自引用被丢弃", () => {
    svc.setMemoryCauses(m2, [m1, m2]); // m2 依赖 m1；自引用丢弃
    svc.setMemoryCauses(m2, [m1, m3]); // 重建替换：m1、m3 都是 m2 的前提

    expect(svc.getRelationNeighbors([m1])).toEqual([m2]);
    expect(svc.getRelationNeighbors([m3])).toEqual([m2]);
    expect(svc.getRelationNeighbors([m2]).sort()).toEqual([m1, m3].sort());

    const rows = dbRef.current!
      .prepare("SELECT fromId FROM memory_relations WHERE toId = ? ORDER BY fromId")
      .all(m2) as { fromId: string }[];
    expect(rows.map((r) => r.fromId)).toEqual([m1, m3].sort());
  });

  it("deleteMemory 级联清理实体关联与因果边", async () => {
    svc.setMemoryEntities(m1, ["独占实体", "共享实体"]);
    svc.setMemoryEntities(m2, ["共享实体"]);
    svc.setMemoryCauses(m2, [m1]);

    svc.deleteMemory(m1);

    expect(svc.getMemoryEntities(m1)).toEqual([]);
    expect(svc.getMemoryEntities(m2)).toEqual(["共享实体"]);
    expect(svc.getRelationNeighbors([m2])).toEqual([]);
    // 独占实体被回收，共享实体保留
    const names = dbRef.current!
      .prepare("SELECT name FROM entities")
      .all() as { name: string }[];
    expect(names.map((n) => n.name)).toEqual(["共享实体"]);
  });
});

// ── 3. 实体扩展索引与检索融合 ──

describe("EntityIndex.getExpandedNeighbors", () => {
  it("合并因果邻居与实体共现邻居，排除种子", async () => {
    const svc = new MemoryService();
    const m1 = await svc.createMemory("test", "manual", "卡一", "内容一", "摘要一");
    const m2 = await svc.createMemory("test", "manual", "卡二", "内容二", "摘要二");
    const m3 = await svc.createMemory("test", "manual", "卡三", "内容三", "摘要三");
    svc.setMemoryEntities(m1, ["React"]);
    svc.setMemoryEntities(m2, ["React"]);
    svc.setMemoryCauses(m3, [m1]); // m1 → m3 因果边

    const index = new EntityIndex();
    const map = index.getExpandedNeighbors([m1]);
    const neighbors = map.get(m1) ?? [];
    expect(neighbors).toContain(m2);
    expect(neighbors).toContain(m3);
    expect(neighbors).not.toContain(m1);
    // 因果邻居排在共现邻居之前
    expect(neighbors.indexOf(m3)).toBeLessThan(neighbors.indexOf(m2));
  });
});

describe("VectorRetriever multi-hop 融合实体/因果扩展", () => {
  it("实体与因果邻居进入 RRF 结果，种子仍居首", async () => {
    vectorIndexMock.search.mockReturnValue([{ memoryId: "seed-1", similarity: 0.9 }]);
    const wikiGraph = { getNeighbors: async (_id: string) => [] as string[] };
    const entityIndex = {
      getExpandedNeighbors: vi.fn(
        (_seedIds: string[]) => new Map([["seed-1", ["neighbor-ent", "neighbor-cause"]]]),
      ),
    };
    const retriever = new VectorRetriever({
      wikiGraph,
      entityIndex,
    });
    try {
      const response = await retriever.searchDetailed("React 和 Vue 的区别是什么？", 5);
      expect(response.route).toBe("multi-hop");
      expect(response.mode).toBe("graph");
      expect(entityIndex.getExpandedNeighbors).toHaveBeenCalledWith(["seed-1"]);
      const ids = response.results.map((r) => r.memoryId);
      expect(ids[0]).toBe("seed-1");
      expect(ids).toContain("neighbor-ent");
      expect(ids).toContain("neighbor-cause");
    } finally {
      retriever.close();
    }
  });

  it("实体扩展为空时 multi-hop 不改变既有行为", async () => {
    vectorIndexMock.search.mockReturnValue([{ memoryId: "seed-1", similarity: 0.9 }]);
    const retriever = new VectorRetriever({
      wikiGraph: { getNeighbors: async () => [] },
      entityIndex: { getExpandedNeighbors: () => new Map() },
    });
    try {
      const response = await retriever.searchDetailed("React 和 Vue 的区别是什么？", 5);
      // 图扩展无结果 → 落回 keyword/hybrid 路径
      expect(response.mode).not.toBe("graph");
    } finally {
      retriever.close();
    }
  });
});

afterEach(() => {
  vi.clearAllMocks();
});
