import { MemoryRecord, PendingEvent } from "../../types/memory";
import { compareMemories, extractChangedFields, DiffResult } from "./differ";
import { resolveConflicts, ConflictResolution } from "./conflict-resolver";
import { VersionManager } from "./version-manager";

export type AuditResult = {
  eventId: string;
  memoryId: string;
  status: "done" | "conflict" | "failed";
  diffs: DiffResult[];
  resolution?: ConflictResolution;
  error?: string;
};

export type MemoryStoreReader = {
  getMemory: (id: string) => MemoryRecord | null;
  dequeueEvent: (memoryId: string) => PendingEvent | null;
  updateEvent: (event: PendingEvent) => void;
};

export class Auditor {
  private store: MemoryStoreReader;
  private versionManager: VersionManager;

  constructor(store: MemoryStoreReader) {
    this.store = store;
    this.versionManager = new VersionManager();
  }

  async process(memoryId: string): Promise<AuditResult | null> {
    const event = this.store.dequeueEvent(memoryId);
    if (!event) return null;

    try {
      const candidate: MemoryRecord = JSON.parse(event.candidate);
      const existing = this.store.getMemory(event.memoryId);

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
        // reject 路径：schema 不兼容 / 数据损坏 / 格式校验失败
        // 按 AGENTS.md 4.10 "不可合并——触发人工接管，不写入任何变更"
        result.status = "failed";
        result.error = resolution.reason;
      }

      this.versionManager.createSnapshot(existing, existing.version);

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
