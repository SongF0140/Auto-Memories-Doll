import { MemoryService } from "./memory-service";
import { AuditService } from "./audit-service";
import { Auditor } from "../../features/audit/auditor";
import { QualityFilterService } from "./quality-filter-service";
import { MemoryRecord, PendingEvent } from "../../types/memory";
import { buildMemoryRecord, buildPendingEvent } from "../../lib/memory/builder";
import { validateMemoryRecord } from "../../lib/memory/validator";
import { buildVectorRecord } from "../../lib/vector/generator";
import { VectorIndex } from "../../lib/vector/index";
import { updateIndexMap } from "../../lib/storage/index-writer";
import { writeMemoryMarkdown, updateAgentMarkdown } from "../../lib/storage/memory-writer";
import { createFailureRecord } from "../../lib/storage/file-manager";
import { MemoryValidationError } from "../../lib/errors";
import { generateId } from "../../lib/utils/id";
import { logger } from "../../lib/logger";

const LIST_LIMIT = 500;

export class Orchestrator {
  private memoryService: MemoryService;
  private auditService: AuditService;
  private auditor: Auditor;
  private qualityFilter: QualityFilterService;

  constructor() {
    this.memoryService = new MemoryService();
    this.auditService = new AuditService();
    this.qualityFilter = new QualityFilterService();
    this.auditor = new Auditor({
      getMemory: (id) => this.memoryService.getMemory(id),
      dequeueEvent: (memoryId) => this.memoryService.dequeueEvent(memoryId),
      updateEvent: (event) => this.memoryService.updateEvent(event),
    });
  }

  async processIngest(
    source: string,
    sourceType: "chat" | "ingest" | "manual" | "mcp" | "skill",
    content: string,
    title: string,
    summary: string,
    tags: string[] = [],
  ): Promise<string> {
    const id = generateId();
    const memory = buildMemoryRecord(
      source,
      sourceType,
      title,
      content,
      summary,
      tags,
      "uncategorized",
      id,
    );

    if (!validateMemoryRecord(memory)) {
      throw new MemoryValidationError("record", "记忆数据不完整");
    }

    const pendingEvent = buildPendingEvent(
      id,
      sourceType,
      memory,
      Object.keys(memory) as string[],
    );

    this.memoryService.enqueueEvent(pendingEvent);
    return pendingEvent.eventId;
  }

  async processQueue(): Promise<void> {
    const pendingEvents = this.getPendingEvents();

    for (const event of pendingEvents) {
      await this.processEvent(event);
    }

    if (pendingEvents.length > 0) {
      const updatedMemories = this.memoryService.listMemories({ limit: LIST_LIMIT });
      await updateIndexMap(updatedMemories).catch((err) =>
        logger.audit.error("Index map update failed", { error: (err as Error).message }),
      );
    }
  }

  private async processEvent(event: PendingEvent): Promise<string | void> {
    try {
      event.status = "processing";
      this.memoryService.updateEvent(event);

      const candidate: MemoryRecord = JSON.parse(event.candidate);
      const existing = this.memoryService.getMemory(event.memoryId);

      if (!existing) {
        const filterResult = await this.qualityFilter.filter(candidate);
        if (!filterResult.ok) {
          event.status = "failed";
          event.retryCount++;
          this.memoryService.updateEvent(event);
          await createFailureRecord(event.memoryId, "quality-filter", new Error(filterResult.reason || "质量未达标")).catch(
            (err) => logger.audit.error("Failure record creation failed", { error: (err as Error).message }),
          );
          return;
        }

        const newId = await this.memoryService.createMemory(
          candidate.source,
          candidate.sourceType,
          candidate.title,
          candidate.content,
          candidate.summary,
          candidate.tags,
          candidate.topic,
          {
            titleZh: candidate.titleZh,
            summaryZh: candidate.summaryZh,
            tagsZh: candidate.tagsZh,
            topicZh: candidate.topicZh,
          },
        );

        const all = this.memoryService.listMemories({ limit: LIST_LIMIT });

        this.memoryService.classifyMemory(newId, candidate.content);

        await Promise.all([
          writeMemoryMarkdown(this.memoryService.getMemory(newId)!),
          updateAgentMarkdown(candidate.topic, all),
          updateIndexMap(all).catch((err) =>
            logger.audit.error("Index map update failed (new memory)", { error: (err as Error).message }),
          ),
        ]);

        event.status = "done";
        this.memoryService.updateEvent(event);
        return newId;
      }

      const auditResult = await this.auditor.process(event.memoryId);

      if (!auditResult) {
        event.status = "failed";
        event.retryCount++;
        this.memoryService.updateEvent(event);
        return;
      }

      if (auditResult.status === "done") {
        const resolution = auditResult.resolution;
        if (resolution && resolution.action === "auto_merge") {
          const merged = resolution.merged;
          this.memoryService.updateMemory(event.memoryId, merged);

          // 内容发生变更时重新生成向量
          if (event.changedFields.includes("content") && merged.content) {
            await this.refreshVector(event.memoryId, merged.content);
          }

          // 同步 Markdown 主存储与话题 Agent.md
          const updated = this.memoryService.getMemory(event.memoryId)!;
          if (event.changedFields.includes("content")) {
            this.memoryService.classifyMemory(event.memoryId, updated.content);
          }
          const all = this.memoryService.listMemories({ limit: LIST_LIMIT });
          await Promise.all([
            writeMemoryMarkdown(updated),
            updateAgentMarkdown(updated.topic, all),
            updateIndexMap(all),
          ]);
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
        (err) => logger.audit.error("Failure record creation failed", { error: (err as Error).message }),
      );
    }
  }

  private async refreshVector(memoryId: string, content: string): Promise<void> {
    const vectorIndex = new VectorIndex();
    try {
      const vectorRecord = await buildVectorRecord(memoryId, content);
      vectorIndex.create(vectorRecord);
      this.memoryService.updateMemory(memoryId, { vectorId: memoryId });
    } catch (vectorError) {
      logger.vector.warn("更新向量失败，记忆仍会继续保存:", { error: (vectorError as Error).message });
    } finally {
      vectorIndex.close();
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
