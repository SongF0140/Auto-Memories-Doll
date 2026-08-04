import { MemoryRecord, PendingEvent } from "../../types/memory";
import { buildMemoryRecord, buildPendingEvent, updateMemoryRecord } from "../../lib/memory/builder";
import { validateMemoryRecord } from "../../lib/memory/validator";
import { MemoryClassifier } from "../../features/memory/classifier";
import { VectorIndex } from "../../lib/vector/index";
import { buildVectorRecord } from "../../lib/vector/generator";
import { getDatabase } from "../../lib/storage/database";
import { withLock } from "../../lib/storage/lock";
import { MemoryNotFoundError, MemoryValidationError } from "../../lib/errors";
import { logger } from "../../lib/logger";
import Database from "better-sqlite3";

export class MemoryService {
  private db: Database.Database;

  constructor() {
    this.db = getDatabase();
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
        titleZh TEXT,
        content TEXT,
        summary TEXT,
        summaryZh TEXT,
        tags TEXT,
        tagsZh TEXT,
        topic TEXT DEFAULT 'uncategorized',
        topicZh TEXT,
        createdAt TEXT,
        updatedAt TEXT,
        accessedAt TEXT,
        accessCount INTEGER,
        heatScore REAL,
        vectorId TEXT,
        graphLinks TEXT
      )
    `);

    // 迁移：旧数据库可能缺少 topic / zh 列
    const migrationColumns = ["topic", "titleZh", "summaryZh", "tagsZh", "topicZh"];
    for (const col of migrationColumns) {
      try {
        this.db.exec(`ALTER TABLE memories ADD COLUMN ${col} TEXT`);
      } catch {
        // 列已存在，跳过
      }
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS pending_events (
        eventId TEXT PRIMARY KEY,
        memoryId TEXT,
        sourceType TEXT,
        eventType TEXT,
        candidate TEXT,
        changedFields TEXT,
        createdAt TEXT,
        status TEXT,
        retryCount INTEGER
      )
    `);
    // 迁移：旧数据库的 pending_events 可能缺少 eventType 列
    try {
      this.db.exec(`ALTER TABLE pending_events ADD COLUMN eventType TEXT`);
    } catch {
      // 列已存在，跳过
    }
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

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_classifications (
        memoryId TEXT PRIMARY KEY,
        category TEXT,
        confidence REAL,
        subcategories TEXT,
        updatedAt TEXT
      )
    `);
  }

  async createMemory(
    source: string,
    sourceType: "chat" | "ingest" | "manual" | "mcp" | "skill" | "listen",
    title: string,
    content: string,
    summary: string,
    tags: string[] = [],
    topic: string = "uncategorized",
    zhFields?: { titleZh?: string; summaryZh?: string; tagsZh?: string[]; topicZh?: string },
  ): Promise<string> {
    return withLock(async () => {
      const memory = buildMemoryRecord(
        source,
        sourceType,
        title,
        content,
        summary,
        tags,
        topic,
        undefined,
        zhFields,
      );

      if (!validateMemoryRecord(memory)) {
        throw new MemoryValidationError("record", "记忆数据不完整");
      }

      const stmt = this.db.prepare(`
      INSERT INTO memories (
        id, version, source, sourceType, title, titleZh, content, summary, summaryZh,
        tags, tagsZh, topic, topicZh,
        createdAt, updatedAt, accessedAt, accessCount, heatScore, graphLinks
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
      stmt.run(
        memory.id,
        memory.version,
        memory.source,
        memory.sourceType,
        memory.title,
        memory.titleZh || null,
        memory.content,
        memory.summary,
        memory.summaryZh || null,
        JSON.stringify(memory.tags),
        memory.tagsZh ? JSON.stringify(memory.tagsZh) : null,
        memory.topic,
        memory.topicZh || null,
        memory.createdAt,
        memory.updatedAt,
        memory.accessedAt,
        memory.accessCount,
        memory.heatScore,
        JSON.stringify(memory.graphLinks),
      );

      const vectorIndex = new VectorIndex();
      try {
        const vectorRecord = await buildVectorRecord(memory.id, content);
        vectorIndex.create(vectorRecord);
        this.db.prepare("UPDATE memories SET vectorId = ? WHERE id = ?").run(memory.id, memory.id);
      } catch (vectorError) {
        logger.memory.warn("向量生成失败，记忆仍会保存:", { error: (vectorError as Error).message });
      }
      vectorIndex.close();

      return memory.id;
    });
  }

  /**
   * 外部入口统一使用：生成待创建记忆的 PendingEvent 并入队。
   * 实际写入 SQLite / 向量 / Markdown 由 Orchestrator 在消费队列时完成。
   */
  stageCreateMemory(
    source: string,
    sourceType: "chat" | "ingest" | "manual" | "mcp" | "skill" | "listen",
    title: string,
    content: string,
    summary: string,
    tags: string[] = [],
    topic: string = "uncategorized",
    zhFields?: { titleZh?: string; summaryZh?: string; tagsZh?: string[]; topicZh?: string },
  ): string {
    const memory = buildMemoryRecord(
      source,
      sourceType,
      title,
      content,
      summary,
      tags,
      topic,
      undefined,
      zhFields,
    );

    if (!validateMemoryRecord(memory)) {
      throw new MemoryValidationError("record", "记忆数据不完整");
    }

    const event = buildPendingEvent(
      memory.id,
      sourceType,
      memory,
      Object.keys(memory) as string[],
    );
    this.enqueueEvent(event);
    return memory.id;
  }

  /**
   * 外部入口统一使用：生成待更新记忆的 PendingEvent 并入队。
   */
  stageUpdateMemory(id: string, updates: Partial<MemoryRecord>): string {
    const existing = this.getMemory(id);
    if (!existing) throw new MemoryNotFoundError(id);

    const candidate = updateMemoryRecord(existing, updates);
    const changedFields = (Object.keys(updates) as string[]).filter((key) => {
      const existingValue = (existing as Record<string, unknown>)[key];
      const candidateValue = (candidate as Record<string, unknown>)[key];
      return JSON.stringify(existingValue) !== JSON.stringify(candidateValue);
    });
    if (changedFields.length === 0) {
      changedFields.push("updatedAt");
    }

    const event = buildPendingEvent(id, candidate.sourceType, candidate, changedFields);
    this.enqueueEvent(event);
    return event.eventId;
  }

  /**
   * 外部入口统一使用：生成待删除记忆的 PendingEvent 并入队。
   * 实际删除由 Orchestrator 在消费队列时完成，保证删除操作同样经过审计队列。
   */
  stageDeleteMemory(memoryId: string): string {
    const existing = this.getMemory(memoryId);
    if (!existing) throw new MemoryNotFoundError(memoryId);

    const event = buildPendingEvent(memoryId, existing.sourceType, existing, [], "delete");
    this.enqueueEvent(event);
    return event.eventId;
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
      titleZh: row.titleZh || undefined,
      content: row.content,
      summary: row.summary,
      summaryZh: row.summaryZh || undefined,
      tags: JSON.parse(row.tags),
      tagsZh: row.tagsZh ? JSON.parse(row.tagsZh) : undefined,
      topic: row.topic || "uncategorized",
      topicZh: row.topicZh || undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      accessedAt: row.accessedAt,
      accessCount: row.accessCount,
      heatScore: row.heatScore,
      vectorId: row.vectorId,
      graphLinks: JSON.parse(row.graphLinks),
    };
  }

  listMemories(opts?: { limit?: number; offset?: number }): MemoryRecord[] {
    const limit = opts?.limit ?? -1;
    const offset = opts?.offset ?? 0;

    let sql = "SELECT * FROM memories ORDER BY updatedAt DESC";
    if (limit > 0) sql += " LIMIT ? OFFSET ?";

    const stmt = this.db.prepare(sql);
    const rows = (limit > 0 ? stmt.all(limit, offset) : stmt.all()) as any[];

    return rows.map((row) => ({
      id: row.id,
      version: row.version,
      source: row.source,
      sourceType: row.sourceType as MemoryRecord["sourceType"],
      title: row.title,
      titleZh: row.titleZh || undefined,
      content: row.content,
      summary: row.summary,
      summaryZh: row.summaryZh || undefined,
      tags: JSON.parse(row.tags),
      tagsZh: row.tagsZh ? JSON.parse(row.tagsZh) : undefined,
      topic: row.topic || "uncategorized",
      topicZh: row.topicZh || undefined,
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
    if (!existing) throw new MemoryNotFoundError(id);

    const updated = { ...existing, ...updates, version: existing.version + 1 };

    const stmt = this.db.prepare(`
      UPDATE memories SET
        version = ?, source = ?, sourceType = ?, title = ?, titleZh = ?, content = ?,
        summary = ?, summaryZh = ?, tags = ?, tagsZh = ?, topic = ?, topicZh = ?,
        updatedAt = ?, accessedAt = ?, accessCount = ?,
        heatScore = ?, vectorId = ?, graphLinks = ?
      WHERE id = ?
    `);
    stmt.run(
      updated.version,
      updated.source,
      updated.sourceType,
      updated.title,
      updated.titleZh || null,
      updated.content,
      updated.summary,
      updated.summaryZh || null,
      JSON.stringify(updated.tags),
      updated.tagsZh ? JSON.stringify(updated.tagsZh) : null,
      updated.topic,
      updated.topicZh || null,
      updated.updatedAt,
      updated.accessedAt,
      updated.accessCount,
      updated.heatScore,
      updated.vectorId,
      JSON.stringify(updated.graphLinks),
      id,
    );
  }

  deleteMemory(id: string): void {
    const stmt = this.db.prepare("DELETE FROM memories WHERE id = ?");
    stmt.run(id);

    const vectorIndex = new VectorIndex();
    vectorIndex.delete(id);
    vectorIndex.close();
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
        eventId, memoryId, sourceType, eventType, candidate, changedFields, createdAt, status, retryCount
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      event.eventId,
      event.memoryId,
      event.sourceType,
      event.eventType || null,
      event.candidate,
      JSON.stringify(event.changedFields),
      event.createdAt,
      event.status,
      event.retryCount,
    );
  }

  dequeueEvent(memoryId: string): PendingEvent | null {
    // 事务包裹 SELECT + UPDATE：保证原子性，防止并发重复消费
    const transaction = this.db.transaction(() => {
      const selectStmt = this.db.prepare(`
        SELECT * FROM pending_events
        WHERE memoryId = ? AND status = 'pending'
        ORDER BY createdAt ASC LIMIT 1
      `);
      const row = selectStmt.get(memoryId) as any;
      if (!row) return null;

      // 乐观锁：只有 status = 'pending' 的行才 UPDATE
      const updateStmt = this.db.prepare(`
        UPDATE pending_events SET status = 'processing' WHERE eventId = ? AND status = 'pending'
      `);
      const result = updateStmt.run(row.eventId);
      if (result.changes === 0) return null; // 被其他消费者抢占

      return {
        eventId: row.eventId,
        memoryId: row.memoryId,
        sourceType: row.sourceType as PendingEvent["sourceType"],
        eventType: (row.eventType || undefined) as PendingEvent["eventType"],
        candidate: row.candidate,
        changedFields: JSON.parse(row.changedFields),
        createdAt: row.createdAt,
        status: "processing" as PendingEvent["status"],
        retryCount: row.retryCount,
      };
    });

    return transaction();
  }

  updateEvent(event: PendingEvent): void {
    const stmt = this.db.prepare(`
      UPDATE pending_events SET status = ?, retryCount = ? WHERE eventId = ?
    `);
    stmt.run(event.status, event.retryCount, event.eventId);
  }

  getPendingEvents(): PendingEvent[] {
    const stmt = this.db.prepare("SELECT * FROM pending_events WHERE status = 'pending'");
    const rows = stmt.all() as any[];

    return rows.map((row) => ({
      eventId: row.eventId,
      memoryId: row.memoryId,
      sourceType: row.sourceType as PendingEvent["sourceType"],
      eventType: (row.eventType || undefined) as PendingEvent["eventType"],
      candidate: row.candidate,
      changedFields: JSON.parse(row.changedFields),
      createdAt: row.createdAt,
      status: row.status as PendingEvent["status"],
      retryCount: row.retryCount,
    }));
  }

  /**
   * 对记忆内容执行分类，并将分类结果持久化到 memory_classifications 表。
   */
  classifyMemory(memoryId: string, content: string): void {
    const classifier = new MemoryClassifier();
    const result = classifier.classify(content);

    const stmt = this.db.prepare(`
      INSERT INTO memory_classifications (memoryId, category, confidence, subcategories, updatedAt)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(memoryId) DO UPDATE SET
        category = excluded.category,
        confidence = excluded.confidence,
        subcategories = excluded.subcategories,
        updatedAt = excluded.updatedAt
    `);
    stmt.run(
      memoryId,
      result.category,
      result.confidence,
      JSON.stringify(result.subcategories),
      new Date().toISOString(),
    );
  }

  getClassification(memoryId: string): {
    memoryId: string;
    category: string;
    confidence: number;
    subcategories: string[];
    updatedAt: string;
  } | null {
    const stmt = this.db.prepare("SELECT * FROM memory_classifications WHERE memoryId = ?");
    const row = stmt.get(memoryId) as any;
    if (!row) return null;

    return {
      memoryId: row.memoryId,
      category: row.category,
      confidence: row.confidence,
      subcategories: JSON.parse(row.subcategories || "[]"),
      updatedAt: row.updatedAt,
    };
  }

  listClassifications(category?: string): Array<{
    memoryId: string;
    category: string;
    confidence: number;
    subcategories: string[];
    updatedAt: string;
  }> {
    const sql = category
      ? "SELECT * FROM memory_classifications WHERE category = ?"
      : "SELECT * FROM memory_classifications";
    const stmt = this.db.prepare(sql);
    const rows = (category ? stmt.all(category) : stmt.all()) as any[];

    return rows.map((row) => ({
      memoryId: row.memoryId,
      category: row.category,
      confidence: row.confidence,
      subcategories: JSON.parse(row.subcategories || "[]"),
      updatedAt: row.updatedAt,
    }));
  }

  /** 不再关闭共享连接，由 closeDatabase() 统一管理 */
  close(): void {
    // shared connection — no-op
  }
}
