import { VectorIndex } from "../../lib/vector/index";
import { buildVectorRecord } from "../../lib/vector/generator";
import { getDatabasePath } from "../../lib/storage/path-resolver";
import Database from "better-sqlite3";

export class VectorWorker {
  private db: Database.Database;

  constructor() {
    this.db = new Database(getDatabasePath());
  }

  async rebuildAllVectors(): Promise<void> {
    const stmt = this.db.prepare("SELECT id, content FROM memories");
    const rows = stmt.all() as any[];

    const vectorIndex = new VectorIndex();
    
    for (const row of rows) {
      try {
        const vectorRecord = await buildVectorRecord(row.id, row.content);
        vectorIndex.create(vectorRecord);
      } catch (error) {
        console.error(`Failed to build vector for memory ${row.id}:`, error);
      }
    }
    
    vectorIndex.close();
  }

  async updateVector(memoryId: string, content: string): Promise<void> {
    const vectorIndex = new VectorIndex();
    
    try {
      const vectorRecord = await buildVectorRecord(memoryId, content);
      vectorIndex.create(vectorRecord);
    } finally {
      vectorIndex.close();
    }
  }

  close(): void {
    this.db.close();
  }
}