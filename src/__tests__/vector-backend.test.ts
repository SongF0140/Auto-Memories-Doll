import { existsSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import {
  createVectorSearchBackend,
  HnswVectorSearchBackend,
  JsVectorSearchBackend,
} from "../lib/vector/backend";

function createVectorTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE vector_records (
      memoryId TEXT PRIMARY KEY,
      embedding BLOB,
      model TEXT,
      dimensions INTEGER,
      updatedAt TEXT
    )
  `);
}

function writeVector(
  db: Database.Database,
  memoryId: string,
  embedding: number[],
): void {
  db.prepare(`
    INSERT INTO vector_records (memoryId, embedding, model, dimensions, updatedAt)
    VALUES (?, ?, 'test-model', ?, '2026-01-01')
    ON CONFLICT(memoryId) DO UPDATE SET
      embedding = excluded.embedding,
      dimensions = excluded.dimensions,
      updatedAt = excluded.updatedAt
  `).run(memoryId, JSON.stringify(embedding), embedding.length);
}

describe("vector search backends", () => {
  const originalBackend = process.env.VECTOR_BACKEND;
  const tempDirs: string[] = [];

  afterEach(() => {
    if (originalBackend === undefined) {
      delete process.env.VECTOR_BACKEND;
    } else {
      process.env.VECTOR_BACKEND = originalBackend;
    }
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("JS fallback ranks rows by exact cosine similarity", () => {
    const backend = new JsVectorSearchBackend([
      { memoryId: "low", embedding: [0, 1] },
      { memoryId: "high", embedding: [1, 0] },
      { memoryId: "mid", embedding: [1, 1] },
    ]);

    const results = backend.search([1, 0], 2);

    expect(results).toEqual([
      { memoryId: "high", similarity: 1 },
      { memoryId: "mid", similarity: expect.closeTo(0.707, 3) },
    ]);
  });

  it("uses HNSW as the default backend", () => {
    delete process.env.VECTOR_BACKEND;
    const db = new Database(":memory:");
    createVectorTable(db);

    const backend = createVectorSearchBackend(db);

    expect(backend.name).toBe("hnsw-usearch");
    db.close();
  });

  it("keeps exact search available as an explicit fallback", () => {
    process.env.VECTOR_BACKEND = "js";
    const db = new Database(":memory:");
    createVectorTable(db);
    writeVector(db, "m1", [1]);

    const backend = createVectorSearchBackend(db);

    expect(backend.name).toBe("js-exact");
    expect(backend.search([1], 10)).toEqual([{ memoryId: "m1", similarity: 1 }]);
    db.close();
  });

  it("migrates the legacy sqlite-vec setting to HNSW instead of brute force", () => {
    process.env.VECTOR_BACKEND = "sqlite-vec";
    const db = new Database(":memory:");
    createVectorTable(db);

    const backend = createVectorSearchBackend(db);

    expect(backend.name).toBe("hnsw-usearch");
    db.close();
  });

  it("searches, updates, and deletes through the HNSW graph", () => {
    const db = new Database(":memory:");
    createVectorTable(db);
    const backend = new HnswVectorSearchBackend(db, null);

    writeVector(db, "x", [1, 0]);
    backend.upsert({ memoryId: "x", embedding: [1, 0], dimensions: 2 });
    writeVector(db, "y", [0, 1]);
    backend.upsert({ memoryId: "y", embedding: [0, 1], dimensions: 2 });

    expect(backend.search([1, 0], 2)[0].memoryId).toBe("x");

    writeVector(db, "x", [0, 1]);
    backend.upsert(
      { memoryId: "x", embedding: [0, 1], dimensions: 2 },
      { memoryId: "x", embedding: [1, 0], dimensions: 2 },
    );
    expect(backend.search([1, 0], 2).at(-1)?.memoryId).toBe("x");

    db.prepare("DELETE FROM vector_records WHERE memoryId = ?").run("x");
    backend.delete("x", { memoryId: "x", embedding: [0, 1], dimensions: 2 });
    expect(backend.search([0, 1], 5).map((result) => result.memoryId)).toEqual(["y"]);
    db.close();
  });

  it("persists the HNSW file and reloads it without rebuilding", () => {
    const dir = mkdtempSync(join(tmpdir(), "amd-hnsw-"));
    tempDirs.push(dir);
    const dbPath = join(dir, "memory.db");
    const indexBasePath = join(dir, "memory.db.ann");

    const firstDb = new Database(dbPath);
    createVectorTable(firstDb);
    const first = new HnswVectorSearchBackend(firstDb, indexBasePath);
    writeVector(firstDb, "persisted", [1, 0, 0]);
    first.upsert({ memoryId: "persisted", embedding: [1, 0, 0], dimensions: 3 });
    expect(first.search([1, 0, 0], 1)[0].memoryId).toBe("persisted");
    expect(existsSync(`${indexBasePath}-3.usearch`)).toBe(true);
    firstDb.close();

    const secondDb = new Database(dbPath);
    const second = new HnswVectorSearchBackend(secondDb, indexBasePath);
    expect(second.search([1, 0, 0], 1)[0].memoryId).toBe("persisted");
    secondDb.close();
  });

  it("rebuilds automatically when SQLite changes behind the loaded index", () => {
    const db = new Database(":memory:");
    createVectorTable(db);
    const backend = new HnswVectorSearchBackend(db, null);
    writeVector(db, "old", [1, 0]);
    backend.upsert({ memoryId: "old", embedding: [1, 0], dimensions: 2 });
    expect(backend.search([1, 0], 1)[0].memoryId).toBe("old");

    // 模拟另一个写入者直接修改 SQLite，但未通知当前进程内 HNSW 状态。
    writeVector(db, "new", [0, 1]);

    expect(backend.search([0, 1], 2)[0].memoryId).toBe("new");
    db.close();
  });
});
