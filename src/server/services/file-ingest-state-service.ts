import Database from "better-sqlite3";
import { getDatabase } from "../../lib/storage/database";
import { getCurrentTime } from "../../lib/utils/date";

/**
 * 文件采集状态（I-10 段级增量）：
 * 记录每个被监听文件上次入库时的内容哈希与长度，
 * 让 file-watcher 能在不保存旧全文的前提下判定"纯追加"。
 * 没有这张表，变更检测只能靠整文件哈希——只能"跳过未变更"，无法"只处理新增"。
 */
export type FileIngestState = {
  path: string;
  contentHash: string;
  contentLength: number;
  /** 该文件累计追加入库的次数，用于派生 delta 卡的稳定 ID */
  appendCount: number;
  updatedAt: string;
};

export class FileIngestStateService {
  private db: Database.Database;

  constructor(db: Database.Database = getDatabase()) {
    this.db = db;
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS file_ingest_state (
        path TEXT PRIMARY KEY,
        contentHash TEXT NOT NULL,
        contentLength INTEGER NOT NULL,
        appendCount INTEGER NOT NULL DEFAULT 0,
        updatedAt TEXT NOT NULL
      )
    `);
  }

  get(path: string): FileIngestState | null {
    const row = this.db.prepare("SELECT * FROM file_ingest_state WHERE path = ?").get(path) as any;
    if (!row) return null;
    return {
      path: row.path,
      contentHash: row.contentHash,
      contentLength: row.contentLength,
      appendCount: row.appendCount ?? 0,
      updatedAt: row.updatedAt,
    };
  }

  /** 记录/刷新文件状态。appendIncrement > 0 表示本次是纯追加入库。 */
  upsert(path: string, contentHash: string, contentLength: number, appendIncrement = 0): void {
    const existing = this.get(path);
    const appendCount = (existing?.appendCount ?? 0) + appendIncrement;
    this.db
      .prepare(
        `INSERT INTO file_ingest_state (path, contentHash, contentLength, appendCount, updatedAt)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET
           contentHash = excluded.contentHash,
           contentLength = excluded.contentLength,
           appendCount = excluded.appendCount,
           updatedAt = excluded.updatedAt`,
      )
      .run(path, contentHash, contentLength, appendCount, getCurrentTime());
  }

  /** 移除状态（文件被删除或需要强制全量重扫时） */
  clear(path: string): void {
    this.db.prepare("DELETE FROM file_ingest_state WHERE path = ?").run(path);
  }

  close(): void {
    // shared connection - closed by closeDatabase()
  }
}
