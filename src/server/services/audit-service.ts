import { MemoryRecord, PendingEvent, ConflictRecord } from "../../types/memory";
import { generateId } from "../../lib/utils/id";
import { getCurrentTime } from "../../lib/utils/date";
import { getDatabase } from "../../lib/storage/database";
import Database from "better-sqlite3";

export type ConflictLevel = "auto_merge" | "manual_decision" | "unmergeable";

export class AuditService {
  private db: Database.Database;

  constructor() {
    this.db = getDatabase();
    this.init();
  }

  private init(): void {
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

  assessConflict(
    existing: MemoryRecord,
    candidate: MemoryRecord,
    changedFields: string[],
  ): ConflictLevel {
    for (const field of changedFields) {
      if (field === "version") continue;

      const existingValue = existing[field as keyof MemoryRecord];
      const candidateValue = candidate[field as keyof MemoryRecord];

      if (JSON.stringify(existingValue) !== JSON.stringify(candidateValue)) {
        if (field === "tags") {
          const existingTags = new Set(existing.tags);
          const candidateTags = new Set(candidate.tags);
          const newTags = Array.from(candidateTags).filter((t) => !existingTags.has(t));
          if (newTags.length > 0) {
            return "auto_merge";
          }
        }

        if (field === "graphLinks") {
          return "auto_merge";
        }

        return "manual_decision";
      }
    }

    return "auto_merge";
  }

  createConflict(
    memoryId: string,
    eventId: string,
    field: string,
    existingValue: any,
    candidateValue: any,
  ): ConflictRecord {
    const conflict: ConflictRecord = {
      conflictId: generateId(),
      memoryId,
      eventId,
      field,
      existingValue: JSON.stringify(existingValue),
      candidateValue: JSON.stringify(candidateValue),
      status: "pending",
      createdAt: getCurrentTime(),
    };

    const stmt = this.db.prepare(`
      INSERT INTO conflict_records (
        conflictId, memoryId, eventId, field, existingValue, candidateValue, status, createdAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      conflict.conflictId,
      conflict.memoryId,
      conflict.eventId,
      conflict.field,
      conflict.existingValue,
      conflict.candidateValue,
      conflict.status,
      conflict.createdAt,
    );

    return conflict;
  }

  resolveConflict(
    conflictId: string,
    resolution: "accept" | "keep" | "manual",
    manualValue?: string,
  ): void {
    const statusMap = {
      accept: "resolved_accept",
      keep: "resolved_keep",
      manual: "resolved_manual",
    };

    const stmt = this.db.prepare(`
      UPDATE conflict_records SET status = ?, resolution = ?, resolvedAt = ? WHERE conflictId = ?
    `);
    stmt.run(statusMap[resolution], manualValue || "", getCurrentTime(), conflictId);
  }

  listConflicts(status?: string): ConflictRecord[] {
    let stmt: Database.Statement;
    if (status) {
      stmt = this.db.prepare("SELECT * FROM conflict_records WHERE status = ?");
    } else {
      stmt = this.db.prepare("SELECT * FROM conflict_records");
    }

    const rows = stmt.all(status) as any[];
    return rows.map((row) => ({
      conflictId: row.conflictId,
      memoryId: row.memoryId,
      eventId: row.eventId,
      field: row.field,
      existingValue: row.existingValue,
      candidateValue: row.candidateValue,
      status: row.status as ConflictRecord["status"],
      resolution: row.resolution,
      createdAt: row.createdAt,
      resolvedAt: row.resolvedAt,
    }));
  }

  close(): void {
    // shared connection — no-op
  }
}
