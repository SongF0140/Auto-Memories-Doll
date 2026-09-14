import { VectorIndex } from "../../lib/vector/index";
import { buildVectorRecord, buildEmbeddingKey } from "../../lib/vector/generator";
import { getDatabase } from "../../lib/storage/database";
import Database from "better-sqlite3";
import { getCurrentTime } from "../../lib/utils/date";
import { logger } from "../../lib/logger";

/** 每批重建的向量数：分批限流，避免一次性打满 embedding 配额 */
const REBUILD_BATCH_SIZE = 50;

/**
 * 全量重建状态：断点续跑的锚点。
 * I-11 改变了 embedding 键（content → summary + windowUse），所有向量需要重建；
 * 借助这张表，重建可以分多次推进（vector-scheduler 每小时调用一次），
 * 中断后从 lastMemoryId 继续，不会重复消耗配额。
 */
type RebuildState = { lastMemoryId: string | null; updatedAt: string | null };

export class VectorWorker {
  private db: Database.Database;

  constructor() {
    this.db = getDatabase();
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS vector_rebuild_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        lastMemoryId TEXT,
        updatedAt TEXT
      );
      INSERT OR IGNORE INTO vector_rebuild_state (id, lastMemoryId, updatedAt)
      VALUES (1, NULL, NULL);
    `);
  }

  /**
   * 全量重建向量（按 memoryId 分批限流 + 断点续跑）。
   * @param batchSize 单批处理条数，默认 REBUILD_BATCH_SIZE
   * @returns 本次处理条数与是否仍有剩余（剩余=true 时下次调用会继续）
   */
  async rebuildAllVectors(
    batchSize: number = REBUILD_BATCH_SIZE,
  ): Promise<{ processed: number; remaining: boolean }> {
    const vectorIndex = new VectorIndex();
    let processed = 0;
    let remaining = false;

    try {
      // 从上次断点之后继续；state 为空说明是全新一轮，从头开始
      const state = this.getRebuildState();
      const cursor = state.lastMemoryId;

      while (true) {
        // 只重建已有 windowUse 的卡片：缺 windowUse 的存量卡由
        // WindowUseBackfillService 先补齐再重嵌——否则 buildEmbeddingKey
        // 回退 content 键，重嵌等于原样重算，白烧配额且键分布不变。
        const rows = (
          cursor
            ? this.db
                .prepare(
                  `SELECT id, summary, windowUse, content FROM memories
                   WHERE id > ? AND windowUse IS NOT NULL AND windowUse != ''
                   ORDER BY id LIMIT ?`,
                )
                .all(cursor, batchSize)
            : this.db
                .prepare(
                  `SELECT id, summary, windowUse, content FROM memories
                   WHERE windowUse IS NOT NULL AND windowUse != ''
                   ORDER BY id LIMIT ?`,
                )
                .all(batchSize)
        ) as Array<{
          id: string;
          summary: string | null;
          windowUse: string | null;
          content: string;
        }>;

        if (rows.length === 0) {
          // 一轮跑完：清空锚点，下次调用从新的一轮开始
          this.saveRebuildState(null);
          break;
        }

        for (const row of rows) {
          try {
            // I-11：embedding 键 = summary + windowUse（缺省回退全文）
            const vectorRecord = await buildVectorRecord(
              row.id,
              buildEmbeddingKey({
                summary: row.summary,
                windowUse: row.windowUse,
                content: row.content,
              }),
            );
            vectorIndex.create(vectorRecord);
            this.db.prepare("UPDATE memories SET vectorId = ? WHERE id = ?").run(row.id, row.id);
            processed += 1;
          } catch (error) {
            logger.vector.error(`Failed to build vector for memory ${row.id}:`, {
              error: (error as Error).message,
            });
          }
        }

        const lastId = rows[rows.length - 1].id;
        this.saveRebuildState(lastId);

        if (rows.length < batchSize) {
          this.saveRebuildState(null);
          break;
        }

        // 达到单次调用的配额上限：保留锚点，剩余部分留给下次调用
        const more = this.db
          .prepare("SELECT 1 FROM memories WHERE id > ? AND windowUse IS NOT NULL AND windowUse != '' LIMIT 1")
          .get(lastId);
        if (!more) {
          this.saveRebuildState(null);
          break;
        }
        remaining = true;
        break;
      }

      return { processed, remaining };
    } finally {
      vectorIndex.close();
    }
  }

  /** 用给定 embedding 键重建单条向量（windowUse 回填后按新键重嵌时调用） */
  async updateVector(memoryId: string, embeddingKey: string): Promise<void> {
    const vectorIndex = new VectorIndex();

    try {
      const vectorRecord = await buildVectorRecord(memoryId, embeddingKey);
      vectorIndex.create(vectorRecord);
      this.db.prepare("UPDATE memories SET vectorId = ? WHERE id = ?").run(memoryId, memoryId);
    } finally {
      vectorIndex.close();
    }
  }

  getRebuildState(): RebuildState {
    const row = this.db
      .prepare("SELECT lastMemoryId, updatedAt FROM vector_rebuild_state WHERE id = 1")
      .get() as { lastMemoryId: string | null; updatedAt: string | null } | undefined;
    return { lastMemoryId: row?.lastMemoryId ?? null, updatedAt: row?.updatedAt ?? null };
  }

  private saveRebuildState(lastMemoryId: string | null): void {
    this.db
      .prepare("UPDATE vector_rebuild_state SET lastMemoryId = ?, updatedAt = ? WHERE id = 1")
      .run(lastMemoryId, getCurrentTime());
  }

  close(): void {
    // shared connection — no-op
  }
}
