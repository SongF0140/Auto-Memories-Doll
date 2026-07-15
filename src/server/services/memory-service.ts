import { MemoryRecord, PendingEvent } from "../../types/memory";
import { buildMemoryRecord, buildPendingEvent } from "../../lib/memory/builder";
import { validateMemoryRecord } from "../../lib/memory/validator";
import { VectorIndex } from "../../lib/vector/index";
import { buildVectorRecord } from "../../lib/vector/generator";
import { GraphManager } from "../../lib/graph/manager";
import { buildGraphEdge, extractRelations } from "../../lib/graph/builder";
import { getDatabasePath } from "../../lib/storage/path-resolver";
import Database from "better-sqlite3";

export class MemoryService {
  private db: Database.Database;

  constructor() {
    this.db = new Database(getDatabasePath());
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        version INTEGER,
        source TEXT,
        sourceType TEXT,
        title TEXT,
        content TEXT,
        summary TEXT,
        tags TEXT,
        createdAt TEXT,
        updatedAt TEXT,
        accessedAt TEXT,
        accessCount INTEGER,
        heatScore REAL,
        vectorId TEXT,
        graphLinks TEXT
      )
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS pending_events (
        eventId TEXT PRIMARY KEY,
        memoryId TEXT,
        sourceType TEXT,
        candidate TEXT,
        changedFields TEXT,
        createdAt TEXT,
        status TEXT,
        retryCount INTEGER
      )
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS conflict_records (
        conflictId TEXT PRIMARY KEY,
        memoryId TEXT,
        eventId TEXT,
        field TEXT,
        existingValue TEXT,
        candidateValue TEXT,
        status TEXT,
        resolution TEXT,
        createdAt TEXT,
        resolvedAt TEXT
      )
    `);
  }

  async createMemory(
    source: string,
    sourceType: "chat" | "ingest" | "manual" | "mcp" | "skill",
    title: string,
    content: string,
    summary: string,
    tags: string[] = []
  ): Promise<string> {
    const memory = buildMemoryRecord(source, sourceType, title, content, summary, tags);
    
    if (!validateMemoryRecord(memory)) {
      throw new Error("Invalid memory record");
    }

    const stmt = this.db.prepare(`
      INSERT INTO memories (
        id, version, source, sourceType, title, content, summary, tags,
        createdAt, updatedAt, accessedAt, accessCount, heatScore, graphLinks
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      memory.id,
      memory.version,
      memory.source,
      memory.sourceType,
      memory.title,
      memory.content,
      memory.summary,
      JSON.stringify(memory.tags),
      memory.createdAt,
      memory.updatedAt,
      memory.accessedAt,
      memory.accessCount,
      memory.heatScore,
      JSON.stringify(memory.graphLinks)
    );

    const vectorIndex = new VectorIndex();
    const vectorRecord = await buildVectorRecord(memory.id, content);
    vectorIndex.create(vectorRecord);
    vectorIndex.close();

    const graphManager = new GraphManager();
    const allMemories = this.listMemories();
    const relations = extractRelations(content, memory.id, allMemories.map(m => m.id));
    relations.forEach(edge => graphManager.create(edge));
    graphManager.close();

    return memory.id;
  }

  getMemory(id: string): MemoryRecord | null {
    const stmt = this.db.prepare("SELECT * FROM memories WHERE id = ?");
    const row = stmt.get(id) as any;
    if (!row) return null;

    return {
      id: row.id,
      version: row.version,
      source: row.source,
      sourceType: row.sourceType as MemoryRecord["sourceType"],
      title: row.title,
      content: row.content,
      summary: row.summary,
      tags: JSON.parse(row.tags),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      accessedAt: row.accessedAt,
      accessCount: row.accessCount,
      heatScore: row.heatScore,
      vectorId: row.vectorId,
      graphLinks: JSON.parse(row.graphLinks),
    };
  }

  listMemories(): MemoryRecord[] {
    const stmt = this.db.prepare("SELECT * FROM memories");
    const rows = stmt.all() as any[];

    return rows.map(row => ({
      id: row.id,
      version: row.version,
      source: row.source,
      sourceType: row.sourceType as MemoryRecord["sourceType"],
      title: row.title,
      content: row.content,
      summary: row.summary,
      tags: JSON.parse(row.tags),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      accessedAt: row.accessedAt,
      accessCount: row.accessCount,
      heatScore: row.heatScore,
      vectorId: row.vectorId,
      graphLinks: JSON.parse(row.graphLinks),
    }));
  }

  updateMemory(id: string, updates: Partial<MemoryRecord>): void {
    const existing = this.getMemory(id);
    if (!existing) throw new Error("Memory not found");

    const updated = { ...existing, ...updates, version: existing.version + 1 };
    
    const stmt = this.db.prepare(`
      UPDATE memories SET
        version = ?, source = ?, sourceType = ?, title = ?, content = ?,
        summary = ?, tags = ?, updatedAt = ?, accessedAt = ?, accessCount = ?,
        heatScore = ?, vectorId = ?, graphLinks = ?
      WHERE id = ?
    `);
    stmt.run(
      updated.version,
      updated.source,
      updated.sourceType,
      updated.title,
      updated.content,
      updated.summary,
      JSON.stringify(updated.tags),
      updated.updatedAt,
      updated.accessedAt,
      updated.accessCount,
      updated.heatScore,
      updated.vectorId,
      JSON.stringify(updated.graphLinks),
      id
    );
  }

  deleteMemory(id: string): void {
    const stmt = this.db.prepare("DELETE FROM memories WHERE id = ?");
    stmt.run(id);

    const vectorIndex = new VectorIndex();
    vectorIndex.delete(id);
    vectorIndex.close();

    const graphManager = new GraphManager();
    const edges = graphManager.getNeighbors(id);
    edges.forEach(edge => graphManager.delete(edge.from, edge.to));
    graphManager.close();
  }

  incrementAccess(id: string): void {
    const stmt = this.db.prepare(`
      UPDATE memories SET accessCount = accessCount + 1, accessedAt = ? WHERE id = ?
    `);
    stmt.run(new Date().toISOString(), id);
  }

  enqueueEvent(event: PendingEvent): void {
    const stmt = this.db.prepare(`
      INSERT INTO pending_events (
        eventId, memoryId, sourceType, candidate, changedFields, createdAt, status, retryCount
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      event.eventId,
      event.memoryId,
      event.sourceType,
      event.candidate,
      JSON.stringify(event.changedFields),
      event.createdAt,
      event.status,
      event.retryCount
    );
  }

  dequeueEvent(memoryId: string): PendingEvent | null {
    const stmt = this.db.prepare(`
      SELECT * FROM pending_events WHERE memoryId = ? AND status = 'pending' ORDER BY createdAt ASC LIMIT 1
    `);
    const row = stmt.get(memoryId) as any;
    if (!row) return null;

    return {
      eventId: row.eventId,
      memoryId: row.memoryId,
      sourceType: row.sourceType as PendingEvent["sourceType"],
      candidate: row.candidate,
      changedFields: JSON.parse(row.changedFields),
      createdAt: row.createdAt,
      status: row.status as PendingEvent["status"],
      retryCount: row.retryCount,
    };
  }

  updateEvent(event: PendingEvent): void {
    const stmt = this.db.prepare(`
      UPDATE pending_events SET status = ?, retryCount = ? WHERE eventId = ?
    `);
    stmt.run(event.status, event.retryCount, event.eventId);
  }

  close(): void {
    this.db.close();
  }
}