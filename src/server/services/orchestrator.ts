import { MemoryService } from "./memory-service";
import { AuditService } from "./audit-service";
import { Auditor } from "../../features/audit/auditor";
import { MemoryRecord, PendingEvent } from "../../types/memory";
import { buildPendingEvent } from "../../lib/memory/builder";
import { validateMemoryRecord } from "../../lib/memory/validator";
import { updateIndexMap } from "../../lib/storage/index-writer";
import { createFailureRecord } from "../../lib/storage/file-manager";
import { MemoryValidationError } from "../../lib/errors";

export class Orchestrator {
  private memoryService: MemoryService;
  private auditService: AuditService;
  private auditor: Auditor;

  constructor() {
    this.memoryService = new MemoryService();
    this.auditService = new AuditService();
    this.auditor = new Auditor();
  }

  async processIngest(
    source: string,
    sourceType: "chat" | "ingest" | "manual" | "mcp" | "skill",
    content: string,
    title: string,
    summary: string,
    tags: string[] = [],
  ): Promise<string> {
    const memory = {
      id: "",
      version: 1,
      source,
      sourceType,
      title,
      content,
      summary,
      tags,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      accessedAt: new Date().toISOString(),
      accessCount: 0,
      heatScore: 0,
      graphLinks: [],
    };

    if (!validateMemoryRecord(memory)) {
      throw new MemoryValidationError("record", "记忆数据不完整");
    }

    const pendingEvent = buildPendingEvent(
      memory.id || "new",
      sourceType,
      memory,
      Object.keys(memory) as string[],
    );

    this.memoryService.enqueueEvent(pendingEvent);
    return pendingEvent.eventId;
  }

  async processQueue(): Promise<void> {
    const pendingEvents = this.getPendingEvents();
    const allMemories = this.memoryService.listMemories();

    for (const event of pendingEvents) {
      await this.processEvent(event, allMemories);
    }

    if (pendingEvents.length > 0) {
      const updatedMemories = this.memoryService.listMemories();
      await updateIndexMap(updatedMemories).catch((err) =>
        console.error("Index map update failed:", err),
      );
    }
  }

  private async processEvent(event: PendingEvent, allMemories: MemoryRecord[]): Promise<void> {
    try {
      event.status = "processing";
      this.memoryService.updateEvent(event);

      const candidate: MemoryRecord = JSON.parse(event.candidate);
      const existing = this.memoryService.getMemory(event.memoryId);

      if (!existing) {
        const newId = await this.memoryService.createMemory(
          candidate.source,
          candidate.sourceType,
          candidate.title,
          candidate.content,
          candidate.summary,
          candidate.tags,
        );

        const all = this.memoryService.listMemories();
        await updateIndexMap(all).catch((err) => console.error("Index map update failed:", err));

        event.status = "done";
        this.memoryService.updateEvent(event);
        return;
      }

      const auditResult = await this.auditor.process(event.memoryId, (id: string) =>
        this.memoryService.getMemory(id),
      );

      if (!auditResult) {
        event.status = "failed";
        event.retryCount++;
        this.memoryService.updateEvent(event);
        return;
      }

      if (auditResult.status === "done") {
        const resolution = auditResult.resolution;
        if (resolution && resolution.action === "auto_merge") {
          this.memoryService.updateMemory(event.memoryId, resolution.merged);
        }
        event.status = "done";
        this.memoryService.updateEvent(event);
      } else if (auditResult.status === "conflict") {
        const resolution = auditResult.resolution;
        if (resolution && resolution.action === "manual_decision") {
          for (const conflict of resolution.conflicts) {
            this.auditService.createConflict(
              event.memoryId,
              event.eventId,
              conflict.field,
              conflict.existingValue,
              conflict.candidateValue,
            );
          }
        }
        event.status = "done";
        this.memoryService.updateEvent(event);
      } else {
        event.status = "failed";
        event.retryCount++;
        this.memoryService.updateEvent(event);
      }
    } catch (error) {
      event.status = "failed";
      event.retryCount++;
      this.memoryService.updateEvent(event);
      await createFailureRecord(event.memoryId, "orchestrator-process", error as Error).catch(
        (err) => console.error("Failure record creation failed:", err),
      );
    }
  }

  private getPendingEvents(): PendingEvent[] {
    return this.memoryService.getPendingEvents();
  }

  close(): void {
    this.memoryService.close();
    this.auditService.close();
    this.auditor.close();
  }
}
