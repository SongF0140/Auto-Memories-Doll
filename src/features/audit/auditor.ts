import { MemoryRecord, PendingEvent } from "../../types/memory";
import { compareMemories, extractChangedFields, DiffResult } from "./differ";
import { resolveConflicts, ConflictResolution } from "./conflict-resolver";
import { AuditQueue } from "./queue";
import { VersionManager } from "./version-manager";

export type AuditResult = {
  eventId: string;
  memoryId: string;
  status: "done" | "conflict" | "failed";
  diffs: DiffResult[];
  resolution?: ConflictResolution;
  error?: string;
};

export class Auditor {
  private queue: AuditQueue;
  private versionManager: VersionManager;

  constructor() {
    this.queue = new AuditQueue();
    this.versionManager = new VersionManager();
  }

  enqueue(event: PendingEvent): void {
    this.queue.enqueue(event);
  }

  getPendingCount(): number {
    return this.queue.size();
  }

  async process(
    memoryId: string,
    getMemory: (id: string) => MemoryRecord | null,
  ): Promise<AuditResult | null> {
    const event = this.queue.dequeueByMemoryId(memoryId);
    if (!event) return null;

    try {
      const candidate: MemoryRecord = JSON.parse(event.candidate);
      const existing = getMemory(event.memoryId);

      const result: AuditResult = {
        eventId: event.eventId,
        memoryId: event.memoryId,
        status: "done",
        diffs: [],
      };

      if (!existing) {
        result.status = "done";
        return result;
      }

      const diffs = compareMemories(existing, candidate);
      result.diffs = diffs;

      if (diffs.length === 0) {
        result.status = "done";
        return result;
      }

      const changedFields = extractChangedFields(diffs);
      const resolution = resolveConflicts(existing, candidate, changedFields);
      result.resolution = resolution;

      if (resolution.action === "auto_merge") {
        result.status = "done";
      } else if (resolution.action === "manual_decision") {
        result.status = "conflict";
      } else {
        result.status = "failed";
      }

      this.versionManager.createSnapshot(existing, existing.version);
      this.queue.removeProcessed(event.memoryId);

      return result;
    } catch (error) {
      return {
        eventId: event.eventId,
        memoryId: event.memoryId,
        status: "failed",
        diffs: [],
        error: (error as Error).message,
      };
    }
  }

  close(): void {
    this.versionManager.close();
  }
}
