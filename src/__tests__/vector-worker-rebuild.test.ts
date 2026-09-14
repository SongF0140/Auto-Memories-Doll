import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";

/**
 * VectorWorker 全量重建单测（I-11 迁移）。
 * 核心语义：只重建已有 windowUse 的卡片——缺 windowUse 的存量卡
 * 由 WindowUseBackfillService 先补齐再重嵌，避免用旧 content 键白烧配额。
 */

const { dbRef, vectorIndexMock, buildVectorRecordMock } = vi.hoisted(() => ({
  dbRef: { current: null as Database.Database | null },
  vectorIndexMock: { create: vi.fn(), close: vi.fn(), delete: vi.fn(), getBackendName: vi.fn() },
  buildVectorRecordMock: vi.fn(),
}));

vi.mock("../lib/storage/database", () => ({
  getDatabase: () => dbRef.current,
  closeDatabase: () => undefined,
}));

vi.mock("../lib/vector/index", () => ({
  VectorIndex: vi.fn(() => vectorIndexMock),
}));

vi.mock("../lib/vector/generator", () => ({
  buildVectorRecord: buildVectorRecordMock,
  buildEmbeddingKey: (input: { summary?: string; windowUse?: string; content?: string }) => {
    const parts = [input.summary?.trim(), input.windowUse?.trim()].filter(Boolean) as string[];
    return parts.length > 0 ? parts.join("\n") : (input.content ?? "").trim();
  },
}));

import { VectorWorker } from "../server/workers/vector-worker";

function seedSchemaAndRows(): void {
  const db = dbRef.current!;
  db.exec(`
    CREATE TABLE memories (
      id TEXT PRIMARY KEY,
      summary TEXT,
      windowUse TEXT,
      content TEXT,
      vectorId TEXT
    );
  `);
  const insert = db.prepare(
    "INSERT INTO memories (id, summary, windowUse, content) VALUES (?, ?, ?, ?)",
  );
  insert.run("mem-old-1", "摘要1", null, "正文1"); // 缺 windowUse → 跳过
  insert.run("mem-new-1", "摘要2", "当用户问 X 时", "正文2"); // 已回填 → 重建
  insert.run("mem-new-2", "摘要3", "当用户问 Y 时", "正文3");
}

beforeEach(() => {
  dbRef.current = new Database(":memory:");
  seedSchemaAndRows();
  vectorIndexMock.create.mockReset();
  vectorIndexMock.close.mockReset();
  vectorIndexMock.getBackendName.mockReset().mockReturnValue("js-exact");
  buildVectorRecordMock.mockReset().mockImplementation(async (memoryId: string, key: string) => ({
    memoryId,
    embedding: [1],
    model: "test",
    dimensions: 1,
    updatedAt: "2026-09-14T00:00:00.000Z",
    key,
  }));
});

afterEach(() => {
  dbRef.current?.close();
  dbRef.current = null;
  vi.restoreAllMocks();
});

describe("VectorWorker.rebuildAllVectors（I-11 迁移）", () => {
  it("只重建已有 windowUse 的卡片，缺 windowUse 的行被跳过", async () => {
    const worker = new VectorWorker();
    const result = await worker.rebuildAllVectors(50);

    expect(result.processed).toBe(2);
    expect(result.remaining).toBe(false);
    // 重建的确实是已回填的两张卡，且键 = summary + windowUse
    const rebuiltKeys = vectorIndexMock.create.mock.calls.map(
      (call) => (call[0] as { memoryId: string; key: string }).key,
    );
    expect(rebuiltKeys).toEqual(["摘要2\n当用户问 X 时", "摘要3\n当用户问 Y 时"]);
    // vectorId 回写
    const row = dbRef.current!.prepare("SELECT vectorId FROM memories WHERE id = ?").get("mem-new-1") as {
      vectorId: string;
    };
    expect(row.vectorId).toBeTruthy();
    // 一轮跑完清空断点
    expect(worker.getRebuildState().lastMemoryId).toBeNull();
  });

  it("分批限流：batchSize 用尽后保留断点，remaining=true", async () => {
    const worker = new VectorWorker();
    const result = await worker.rebuildAllVectors(1);

    expect(result.processed).toBe(1);
    expect(result.remaining).toBe(true);
    expect(worker.getRebuildState().lastMemoryId).toBe("mem-new-1");
  });

  it("updateVector 用给定键重嵌并回写 vectorId", async () => {
    const worker = new VectorWorker();
    await worker.updateVector("mem-old-1", "摘要1\n当用户问 Z 时");

    expect(buildVectorRecordMock).toHaveBeenCalledWith("mem-old-1", "摘要1\n当用户问 Z 时");
    const row = dbRef.current!.prepare("SELECT vectorId FROM memories WHERE id = ?").get("mem-old-1") as {
      vectorId: string;
    };
    expect(row.vectorId).toBeTruthy();
  });
});
