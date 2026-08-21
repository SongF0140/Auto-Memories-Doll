import Database from "better-sqlite3";
import { VectorRecord } from "../../types/memory";
import { getDatabase } from "../storage/database";
import { logger } from "../logger";
import {
  createVectorSearchBackend,
  VectorSearchBackend,
  VectorSearchRow,
} from "./backend";

type CachedBackend = {
  kind: string;
  backend: VectorSearchBackend;
};

const sharedBackends = new WeakMap<Database.Database, CachedBackend>();

function rowFromRecord(record: VectorRecord): VectorSearchRow {
  return {
    memoryId: record.memoryId,
    embedding: record.embedding,
    dimensions: record.dimensions,
  };
}

export class VectorIndex {
  private db: Database.Database;
  private searchBackend: VectorSearchBackend;

  constructor() {
    this.db = getDatabase();
    this.init();
    this.searchBackend = this.getBackend();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS vector_records (
        memoryId TEXT PRIMARY KEY,
        embedding BLOB,
        model TEXT,
        dimensions INTEGER,
        updatedAt TEXT
      )
    `);
  }

  create(record: VectorRecord): void {
    const previous = this.read(record.memoryId);
    const stmt = this.db.prepare(`
      INSERT INTO vector_records (memoryId, embedding, model, dimensions, updatedAt)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(memoryId) DO UPDATE SET
        embedding = excluded.embedding,
        model = excluded.model,
        dimensions = excluded.dimensions,
        updatedAt = excluded.updatedAt
    `);
    stmt.run(
      record.memoryId,
      JSON.stringify(record.embedding),
      record.model,
      record.dimensions,
      record.updatedAt,
    );
    this.searchBackend.upsert(rowFromRecord(record), previous ? rowFromRecord(previous) : null);
  }

  read(memoryId: string): VectorRecord | null {
    const stmt = this.db.prepare("SELECT * FROM vector_records WHERE memoryId = ?");
    const row = stmt.get(memoryId) as any;
    if (!row) return null;

    return {
      memoryId: row.memoryId,
      embedding: JSON.parse(row.embedding),
      model: row.model,
      dimensions: row.dimensions,
      updatedAt: row.updatedAt,
    };
  }

  update(record: VectorRecord): void {
    this.create(record);
  }

  delete(memoryId: string): void {
    const previous = this.read(memoryId);
    const stmt = this.db.prepare("DELETE FROM vector_records WHERE memoryId = ?");
    stmt.run(memoryId);
    this.searchBackend.delete(memoryId, previous ? rowFromRecord(previous) : null);
  }

  search(embedding: number[], limit: number): { memoryId: string; similarity: number }[] {
    try {
      return this.searchBackend.search(embedding, limit);
    } catch (error) {
      if (this.searchBackend.name === "js-exact") throw error;

      logger.vector.warn("HNSW 查询失败，本次请求降级为 JS 精确检索", {
        error: (error as Error).message,
      });
      return createVectorSearchBackend(this.db, "js").search(embedding, limit);
    }
  }

  rebuild(dimensions?: number): void {
    this.searchBackend.rebuild(dimensions);
  }

  getBackendName(): string {
    return this.searchBackend.name;
  }

  list(): VectorRecord[] {
    const stmt = this.db.prepare("SELECT * FROM vector_records");
    const rows = stmt.all() as any[];
    return rows.map((row) => ({
      memoryId: row.memoryId,
      embedding: JSON.parse(row.embedding),
      model: row.model,
      dimensions: row.dimensions,
      updatedAt: row.updatedAt,
    }));
  }

  close(): void {
    this.searchBackend.close?.();
    this.searchBackend.dispose?.();
    this.searchBackend.free?.();
    sharedBackends.delete(this.db);
  }

  private getBackend(): VectorSearchBackend {
    const kind = process.env.VECTOR_BACKEND || "hnsw";

    // 内存数据库只用于测试；不共享可避免测试直接清表后残留进程内索引。
    if (this.db.name === ":memory:") return createVectorSearchBackend(this.db, kind);

    const cached = sharedBackends.get(this.db);
    if (cached?.kind === kind) return cached.backend;

    const backend = createVectorSearchBackend(this.db, kind);
    sharedBackends.set(this.db, { kind, backend });
    return backend;
  }
}
