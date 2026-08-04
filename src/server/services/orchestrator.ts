import { MemoryService } from "./memory-service";
import { AuditService } from "./audit-service";
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
import { createFailureRecord } from "../../lib/storage/file-manager";
import { getArchivePath } from "../../lib/storage/path-resolver";
import { processJsonPipeline } from "../pipelines/json-pipeline";
import { MemoryValidationError } from "../../lib/errors";
import { generateId } from "../../lib/utils/id";
import { getCurrentTime } from "../../lib/utils/date";
import { logger } from "../../lib/logger";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const LIST_LIMIT = 500;
/** 去重时拉取的最近记忆条数，避免全量加载 */
const DEDUP_SAMPLE_SIZE = 200;

export class Orchestrator {
  private memoryService: MemoryService;
  private auditService: AuditService;
  private auditor: Auditor;
  private qualityFilter: QualityFilterService;
  private reporter: AuditReporter;

  constructor() {
    this.memoryService = new MemoryService();
    this.auditService = new AuditService();
    this.qualityFilter = new QualityFilterService();
    this.reporter = new AuditReporter();
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
    const existingContents = this.memoryService
      .listMemories({ limit: DEDUP_SAMPLE_SIZE })
      .map((m) => m.content);

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
        ? pipelineResult.chunks
            .map((c, i) => `## 部分 ${i + 1}\n\n${c.content}`)
            .join("\n\n")
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

      // 队列处理完成后生成可读 Markdown 审计报告，对应《架构检查文档.md》4.7
      await this.writeMarkdownAuditReport().catch((err) =>
        logger.audit.error("Markdown audit report generation failed", { error: (err as Error).message }),
      );
    }
  }

  /** 生成 Markdown 审计报告并落盘到 archive/audits/audit-{timestamp}.md */
  private async writeMarkdownAuditReport(): Promise<void> {
    const markdown = await this.reporter.generateMarkdownReport();
    const auditsDir = join(getArchivePath(), "audits");
    mkdirSync(auditsDir, { recursive: true });
    const timestamp = getCurrentTime().replace(/[:.]/g, "-").substring(0, 19);
    const filePath = join(auditsDir, `audit-${timestamp}.md`);
    writeFileSync(filePath, markdown, "utf-8");
    logger.audit.info("Markdown 审计报告已落盘", { path: filePath });
  }

  private async processEvent(event: PendingEvent): Promise<string | void> {
    try {
      const candidate: MemoryRecord = JSON.parse(event.candidate);

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
    this.reporter.close();
  }
}
