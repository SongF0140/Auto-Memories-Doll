import { MemoryService } from "./memory-service";
import { AuditService } from "./audit-service";
import { MemoryRecord, PendingEvent } from "../../types/memory";
import { buildPendingEvent } from "../../lib/memory/builder";
import { validateMemoryRecord } from "../../lib/memory/validator";

export class Orchestrator {
  private memoryService: MemoryService;
  private auditService: AuditService;

  constructor() {
    this.memoryService = new MemoryService();
    this.auditService = new AuditService();
  }

  async processIngest(
    source: string,
    sourceType: "chat" | "ingest" | "manual" | "mcp" | "skill",
    content: string,
    title: string,
    summary: string,
    tags: string[] = []
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
      throw new Error("Invalid memory record");
    }

    const pendingEvent = buildPendingEvent(
      memory.id || "new",
      sourceType,
      memory,
      Object.keys(memory) as string[]
    );

    this.memoryService.enqueueEvent(pendingEvent);
    return pendingEvent.eventId;
  }

  async processQueue(): Promise<void> {
    const pendingEvents = this.getPendingEvents();
    
    for (const event of pendingEvents) {
      await this.processEvent(event);
    }
  }

  private async processEvent(event: PendingEvent): Promise<void> {
    try {
      event.status = "processing";
      this.memoryService.updateEvent(event);

      const candidate: MemoryRecord = JSON.parse(event.candidate);
      const existing = this.memoryService.getMemory(event.memoryId);

      if (!existing) {
        await this.memoryService.createMemory(
          candidate.source,
          candidate.sourceType,
          candidate.title,
          candidate.content,
          candidate.summary,
          candidate.tags
        );
        event.status = "done";
        this.memoryService.updateEvent(event);
        return;
      }

      const conflictLevel = this.auditService.assessConflict(existing, candidate, event.changedFields);

      if (conflictLevel === "auto_merge") {
        const mergedTags = [...new Set([...existing.tags, ...candidate.tags])];
        const mergedLinks = [...new Set([...existing.graphLinks, ...candidate.graphLinks])];

        this.memoryService.updateMemory(event.memoryId, {
          ...candidate,
          tags: mergedTags,
          graphLinks: mergedLinks,
        });
        event.status = "done";
        this.memoryService.updateEvent(event);
      } else if (conflictLevel === "manual_decision") {
        for (const field of event.changedFields) {
          if (field === "version" || field === "tags" || field === "graphLinks") continue;
          
          const existingValue = existing[field as keyof MemoryRecord];
          const candidateValue = candidate[field as keyof MemoryRecord];
          
          if (JSON.stringify(existingValue) !== JSON.stringify(candidateValue)) {
            this.auditService.createConflict(
              event.memoryId,
              event.eventId,
              field,
              existingValue,
              candidateValue
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
    }
  }

  private getPendingEvents(): PendingEvent[] {
    const stmt = this.memoryService["db"].prepare("SELECT * FROM pending_events WHERE status = 'pending'");
    const rows = stmt.all() as any[];
    
    return rows.map(row => ({
      eventId: row.eventId,
      memoryId: row.memoryId,
      sourceType: row.sourceType as PendingEvent["sourceType"],
      candidate: row.candidate,
      changedFields: JSON.parse(row.changedFields),
      createdAt: row.createdAt,
      status: row.status as PendingEvent["status"],
      retryCount: row.retryCount,
    }));
  }

  close(): void {
    this.memoryService.close();
    this.auditService.close();
  }
}