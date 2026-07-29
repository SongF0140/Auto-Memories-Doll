import { getDatabase } from "../../lib/storage/database";
import Database from "better-sqlite3";

export class CleanupWorker {
  private db: Database.Database;

  constructor() {
    this.db = getDatabase();
  }

  async cleanupOldEvents(): Promise<void> {
    const cutoffTime = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const stmt = this.db.prepare(
      "DELETE FROM pending_events WHERE status = 'done' AND createdAt < ?",
    );
    stmt.run(cutoffTime);
  }

  async cleanupResolvedConflicts(): Promise<void> {
    const cutoffTime = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const stmt = this.db.prepare(
      "DELETE FROM conflict_records WHERE status LIKE 'resolved_%' AND resolvedAt < ?",
    );
    stmt.run(cutoffTime);
  }

  async vacuum(): Promise<void> {
    this.db.exec("VACUUM");
  }

  close(): void {
    // shared connection — no-op
  }
}
