import { MemoryService } from "./memory-service";
import { AuditService } from "./audit-service";
import { AuditReportWriter } from "./audit-report-writer";
import { Auditor } from "../../features/audit/auditor";
import { AuditReporter } from "../../features/audit/reporter";
import { QualityFilterService } from "./quality-filter-service";
import { MemoryRecord, PendingEvent } from "../../types/memory";
import { buildMemoryRecord, buildPendingEvent } from "../../lib/memory/builder";
import { validateMemoryRecord } from "../../lib/memory/validator";
import { buildVectorRecord } from "../../lib/vector/generator";
import { VectorIndex } from "../../lib/vector/index";
import { updateIndexMap } from "../../lib/storage/index-writer";
import { writeMemoryMarkdown, updateAgentMarkdown } from "../../lib/storage/memory-writer";
import { createFailureRecord, deleteFile } from "../../lib/storage/file-manager";
import { getNotePath } from "../../lib/storage/path-resolver";
import { processJsonPipeline } from "../pipelines/json-pipeline";
import { MemoryValidationError } from "../../lib/errors";
import { generateId } from "../../lib/utils/id";
import { getCurrentTime } from "../../lib/utils/date";
import { logger } from "../../lib/logger";
import { VersionManager } from "../../features/audit/version-manager";

const LIST_LIMIT = 500;
const QUEUE_BATCH_SIZE = 100;
/**
 * 去重时拉取的最近记忆条数。
 *
 * 限制：样本量固定，当资料库超过此值时，只对最近
 * N 条做去重。长期建议改为基于向量的语义去重。
 */
const DEDUP_SAMPLE_SIZE = 200;

const RESOLVABLE_MEMORY_FIELDS = new Set<keyof MemoryRecord>([
  "source",
  "sourceType",
  "title",
  "titleZh",
  "content",
  "summary",
  "summaryZh",
  "tags",
  "tagsZh",
  "topic",
  "topicZh",
  "graphLinks",
]);

export class Orchestrator {
  private memoryService: MemoryService;
  private auditService: AuditService;
  private auditor: Auditor;
  private qualityFilter: QualityFilterService;
  private reporter: AuditReporter;
  private auditReportWriter: AuditReportWriter;

  constructor() {
    this.memoryService = new MemoryService();
    this.auditService = new AuditService();
    this.qualityFilter = new QualityFilterService();
    this.reporter = new AuditReporter();
    this.auditReportWriter = new AuditReportWriter(this.reporter);
    this.auditor = new Auditor({
      getMemory: (id) => this.memoryService.getMemory(id),
      dequeueEvent: (memoryId) => this.memoryService.dequeueEvent(memoryId),
      updateEvent: (event) => this.memoryService.updateEvent(event),
    });
  }

  /**
   * 后台主链路：归一化 → 去重 → 拆包 → 入队。
   *
   * 与《架构检查文档.md》4.3 "不要让原始输入直接进入索引和记忆" 对齐：
   *   1. formatMemoryContent 清洗格式
   *   2. detectDuplicates 与最近 N 条记忆做 Jaccard 去重
   *   3. splitText 长文按段落切分，多 chunk 合并为 markdown 分段正文
   *   4. formatSummary 生成短摘要
   * 通过这三步后，再进入 buildMemoryRecord + 入待审计队列。
   */
  async processIngest(
    source: string,
    sourceType: "chat" | "ingest" | "manual" | "mcp" | "skill",
    content: string,
    title: string,
    summary: string,
    tags: string[] = [],
  ): Promise<string> {
    // 1. 预处理：清洗 + 去重 + 拆包
    const existingContents = this.memoryService.listMemoryContents();
    const totalCount = this.memoryService.count(); // 资料库总量
    if (totalCount > DEDUP_SAMPLE_SIZE) {
      logger.ingest.warn(
        `资料库已有 ${totalCount} 条记忆，去重将扫描全部正文内容。` +
          `如需更高性能，可升级为向量语义去重或优化去重索引。`,
      );
    }
    const pipelineResult = await processJsonPipeline(content, existingContents);

    if (pipelineResult.isDuplicate) {
      throw new MemoryValidationError(
        "content",
        `内容与现有记忆高度重复（相似度 ${(pipelineResult.similarity * 100).toFixed(1)}%），已拒绝入库`,
      );
    }

    if (pipelineResult.chunks.length === 0) {
      throw new MemoryValidationError("content", "内容为空或经清洗后无效");
    }

    // 多 chunk 合并为 markdown 分段正文（保留全部内容，避免长文截断丢失）
    const finalContent =
      pipelineResult.chunks.length > 1
        ? pipelineResult.chunks.map((c, i) => `## 部分 ${i + 1}\n\n${c.content}`).join("\n\n")
        : pipelineResult.chunks[0].content;

    // pipeline 自动生成的 summary 优先级低于调用方传入的 summary
    const finalSummary = summary || pipelineResult.chunks[0].summary;
    // 合并调用方 tags 与 pipeline 自动提取的 tags
    const finalTags = [...new Set([...tags, ...pipelineResult.chunks.flatMap((c) => c.tags)])];

    // 2. 构建记忆记录并校验
    const id = generateId();
    const memory = buildMemoryRecord(
      source,
      sourceType,
      title,
      finalContent,
      finalSummary,
      finalTags,
      "uncategorized",
      id,
    );

    if (!validateMemoryRecord(memory)) {
      throw new MemoryValidationError("record", "记忆数据不完整");
    }

    // 3. 入待审计队列（实际落盘由 processQueue 消费时完成）
    const pendingEvent = buildPendingEvent(id, sourceType, memory, Object.keys(memory) as string[]);

    this.memoryService.enqueueEvent(pendingEvent);
    return pendingEvent.eventId;
  }

  async processQueue(): Promise<void> {
    const pendingEvents = this.getPendingEvents({ limit: QUEUE_BATCH_SIZE });

    for (const event of pendingEvents) {
      await this.processEvent(event);
    }

    if (pendingEvents.length > 0) {
      const updatedMemories = this.memoryService.listMemories({ limit: LIST_LIMIT });
      await updateIndexMap(updatedMemories).catch((err) =>
        logger.audit.error("Index map update failed", { error: (err as Error).message }),
      );

      // 队列处理完成后生成可读 Markdown 审计报告，对应《架构检查文档.md》4.7
      await this.auditReportWriter
        .write()
        .catch((err) =>
          logger.audit.error("Markdown audit report generation failed", {
            error: (err as Error).message,
          }),
        );
    }
  }

  private async processEvent(event: PendingEvent): Promise<string | void> {
    try {
      const candidate = this.parseCandidate(event);

      // 删除事件：直接删除记忆，不经过审计差异比对
      if (event.eventType === "delete") {
        event.status = "processing";
        this.memoryService.updateEvent(event);

        this.memoryService.deleteMemory(event.memoryId);

        event.status = "done";
        this.memoryService.updateEvent(event);
        return;
      }

      const existing = this.memoryService.getMemory(event.memoryId);

      if (!existing) {
        // 新建路径：声明 processing 占位，避免并发重复创建
        event.status = "processing";
        this.memoryService.updateEvent(event);

        const filterResult = await this.qualityFilter.filter(candidate);
        if (!filterResult.ok) {
          event.status = "failed";
          event.retryCount++;
          this.memoryService.updateEvent(event);
          await createFailureRecord(
            event.memoryId,
            "quality-filter",
            new Error(filterResult.reason || "质量未达标"),
          ).catch((err) =>
            logger.audit.error("Failure record creation failed", { error: (err as Error).message }),
          );
          return;
        }

        if (candidate.id !== event.memoryId) {
          throw new MemoryValidationError(
            "id",
            `候选记忆 ID (${candidate.id}) 与队列 memoryId (${event.memoryId}) 不一致`,
          );
        }

        const newId = await this.memoryService.createMemoryRecord(candidate);

        const all = this.memoryService.listMemories({ limit: LIST_LIMIT });

        this.memoryService.classifyMemory(newId, candidate.content);

        await Promise.all([
          writeMemoryMarkdown(this.memoryService.getMemory(newId)!),
          updateAgentMarkdown(candidate.topic, all),
          updateIndexMap(all).catch((err) =>
            logger.audit.error("Index map update failed (new memory)", {
              error: (err as Error).message,
            }),
          ),
        ]);

        event.status = "done";
        this.memoryService.updateEvent(event);
        return newId;
      }

      // 更新路径：由 Auditor.process → dequeueEvent 原子声明（pending → processing）。
      // 此处不能再提前置为 processing，否则 dequeueEvent 查不到 pending 事件会返回 null。
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
        // PendingEvent 的审计阶段已经结束；尚未裁决的状态由
        // conflict_records.status='pending' 单独承载。
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
        (err) =>
          logger.audit.error("Failure record creation failed", { error: (err as Error).message }),
      );
    }
  }

  private async refreshVector(memoryId: string, content: string): Promise<void> {
    const vectorIndex = new VectorIndex();
    try {
      const vectorRecord = await buildVectorRecord(memoryId, content);
      vectorIndex.create(vectorRecord);
      this.memoryService.setVectorId(memoryId, memoryId);
    } catch (vectorError) {
      logger.vector.warn("更新向量失败，记忆仍会继续保存:", {
        error: (vectorError as Error).message,
      });
    } finally {
      vectorIndex.close();
    }
  }

  /**
   * 执行人工冲突解决命令。
   *
   * 冲突记录只是审计凭证；只有本方法完成 SQLite 更新及所有派生存储同步后，
   * 冲突才会被标记为 resolved，避免 UI 出现“已解决但正文未变化”。
   */
  async resolveConflict(
    conflictId: string,
    resolution: "accept" | "keep" | "manual",
    manualValue?: string,
  ): Promise<MemoryRecord> {
    const conflict = this.auditService.getConflict(conflictId);
    if (!conflict) throw new Error(`冲突不存在: ${conflictId}`);
    if (conflict.status !== "pending") throw new Error(`冲突已解决: ${conflictId}`);

    const existing = this.memoryService.getMemory(conflict.memoryId);
    if (!existing) throw new Error(`冲突对应的记忆不存在: ${conflict.memoryId}`);

    const field = conflict.field as keyof MemoryRecord;
    if (!RESOLVABLE_MEMORY_FIELDS.has(field)) {
      throw new Error(`不允许通过冲突命令修改字段: ${conflict.field}`);
    }

    let selectedValue: unknown;
    if (resolution === "accept") {
      selectedValue = this.parseConflictValue(conflict.candidateValue);
    } else if (resolution === "manual") {
      if (manualValue === undefined) throw new Error("手动解决冲突时必须提供 manualValue");
      selectedValue = this.parseConflictValue(manualValue);
    }

    let updated = existing;
    if (resolution !== "keep") {
      const candidate = {
        ...existing,
        [field]: selectedValue,
        updatedAt: getCurrentTime(),
      } as MemoryRecord;
      if (!validateMemoryRecord(candidate)) {
        throw new MemoryValidationError(conflict.field, "冲突解决值会产生无效的记忆记录");
      }

      if (JSON.stringify(existing[field]) !== JSON.stringify(selectedValue)) {
        const versionManager = new VersionManager();
        try {
          if (!versionManager.getSnapshot(existing.id, existing.version)) {
            versionManager.createSnapshot(existing, existing.version);
          }
        } finally {
          versionManager.close();
        }
        this.memoryService.updateMemory(existing.id, {
          [field]: selectedValue,
          updatedAt: candidate.updatedAt,
        } as Partial<MemoryRecord>);
        updated = this.memoryService.getMemory(existing.id)!;
      }
    }

    updated = await this.syncResolvedMemory(existing, updated);
    this.auditService.markConflictResolved(conflictId, resolution, manualValue);
    return updated;
  }

  private parseConflictValue(raw: string): unknown {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }

  private async syncResolvedMemory(
    previous: MemoryRecord,
    updated: MemoryRecord,
  ): Promise<MemoryRecord> {
    if (previous.content !== updated.content) {
      await this.refreshVector(updated.id, updated.content);
      this.memoryService.classifyMemory(updated.id, updated.content);
      updated = this.memoryService.getMemory(updated.id)!;
    }

    await writeMemoryMarkdown(updated);
    if (previous.topic !== updated.topic) {
      await deleteFile(getNotePath(previous.topic, previous.id));
    }

    const all = this.memoryService.listMemories({ limit: LIST_LIMIT });
    const topics = [...new Set([previous.topic, updated.topic])];
    await Promise.all([
      ...topics.map((topic) => updateAgentMarkdown(topic, all)),
      updateIndexMap(all),
    ]);
    return updated;
  }

  getPendingEvents(opts?: { limit?: number }): PendingEvent[] {
    return this.memoryService.getPendingEvents(opts);
  }

  private parseCandidate(event: PendingEvent): MemoryRecord {
    try {
      return JSON.parse(event.candidate) as MemoryRecord;
    } catch (error) {
      throw new MemoryValidationError(
        "candidate",
        `PendingEvent ${event.eventId} for memory ${event.memoryId} contains invalid candidate JSON: ${
          (error as Error).message
        }`,
      );
    }
  }

  /** 重试失败事件：将 retryCount < 3 的失败事件重置为 pending。供 AuditWorker 调用。 */
  retryFailedEvents(): number {
    const memory = this.memoryService;
    // 导出接口：listPendingEvents 返回完整列表供重试用
    const pending = memory.getPendingEvents();
    let retried = 0;

    for (const event of pending) {
      if (event.status === "failed" && event.retryCount < 3) {
        memory.updateEvent({ ...event, status: "pending" });
        retried++;
      }
    }
    return retried;
  }

  close(): void {
    this.memoryService.close();
    this.auditService.close();
    this.auditor.close();
    this.reporter.close();
  }
}
