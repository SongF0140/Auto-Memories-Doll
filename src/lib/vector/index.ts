import { VectorRecord } from "../../types/memory";
import { getDatabase } from "../storage/database";
import { createVectorSearchBackend, VectorSearchBackend } from "./backend";
import Database from "better-sqlite3";

export class VectorIndex {
  private db: Database.Database;
  private searchBackend: VectorSearchBackend;

  constructor() {
    this.db = getDatabase();
    this.searchBackend = createVectorSearchBackend();
    this.init();
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
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO vector_records (memoryId, embedding, model, dimensions, updatedAt)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(
      record.memoryId,
      JSON.stringify(record.embedding),
      record.model,
      record.dimensions,
      record.updatedAt,
    );
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
    const stmt = this.db.prepare("DELETE FROM vector_records WHERE memoryId = ?");
    stmt.run(memoryId);
  }

  search(embedding: number[], limit: number): { memoryId: string; similarity: number }[] {
    const stmt = this.db.prepare("SELECT * FROM vector_records");
    const rows = stmt.all() as any[];

    return this.searchBackend.search(
      embedding,
      rows.map((row) => ({
        memoryId: row.memoryId,
        embedding: JSON.parse(row.embedding as string),
      })),
      limit,
    );
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
    // shared connection — no-op
  }
}
