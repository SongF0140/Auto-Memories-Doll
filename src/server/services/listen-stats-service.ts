import Database from "better-sqlite3";
import { getDatabase } from "../../lib/storage/database";

export type ListenStats = {
  totalReceived: number;
  totalProcessed: number;
  lastReceivedAt: string | null;
  sources: Record<string, number>;
  topics: Record<string, number>;
};

const DEFAULT_STATS: ListenStats = {
  totalReceived: 0,
  totalProcessed: 0,
  lastReceivedAt: null,
  sources: {},
  topics: {},
};

export class ListenStatsService {
  private db: Database.Database;

  constructor(db: Database.Database = getDatabase()) {
    this.db = db;
    this.init();
  }

  record(source: string, topic: string, processed: boolean): ListenStats {
    const current = this.getStats();
    const next: ListenStats = {
      totalReceived: current.totalReceived + 1,
      totalProcessed: current.totalProcessed + (processed ? 1 : 0),
      lastReceivedAt: new Date().toISOString(),
      sources: {
        ...current.sources,
        [source]: (current.sources[source] || 0) + 1,
      },
      topics: {
        ...current.topics,
        [topic]: (current.topics[topic] || 0) + 1,
      },
    };
    this.save(next);
    return next;
  }

  getStats(): ListenStats {
    const row = this.db.prepare("SELECT * FROM listen_stats WHERE id = 1").get() as
      | {
          totalReceived: number;
          totalProcessed: number;
          lastReceivedAt: string | null;
          sources: string;
          topics: string;
        }
      | undefined;

    if (!row) return { ...DEFAULT_STATS };

    return {
      totalReceived: row.totalReceived,
      totalProcessed: row.totalProcessed,
      lastReceivedAt: row.lastReceivedAt,
      sources: parseRecord(row.sources),
      topics: parseRecord(row.topics),
    };
  }

  close(): void {
    // shared connection - closed by closeDatabase()
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS listen_stats (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        totalReceived INTEGER NOT NULL DEFAULT 0,
        totalProcessed INTEGER NOT NULL DEFAULT 0,
        lastReceivedAt TEXT,
        sources TEXT NOT NULL DEFAULT '{}',
        topics TEXT NOT NULL DEFAULT '{}'
      );

      INSERT OR IGNORE INTO listen_stats (
        id, totalReceived, totalProcessed, lastReceivedAt, sources, topics
      ) VALUES (1, 0, 0, NULL, '{}', '{}');
    `);
  }

  private save(stats: ListenStats): void {
    this.db
      .prepare(
        `
        UPDATE listen_stats
        SET totalReceived = ?,
            totalProcessed = ?,
            lastReceivedAt = ?,
            sources = ?,
            topics = ?
        WHERE id = 1
      `,
      )
      .run(
        stats.totalReceived,
        stats.totalProcessed,
        stats.lastReceivedAt,
        JSON.stringify(stats.sources),
        JSON.stringify(stats.topics),
      );
  }
}

function parseRecord(raw: string): Record<string, number> {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, number] => {
        return typeof entry[1] === "number";
      }),
    );
  } catch {
    return {};
  }
}
