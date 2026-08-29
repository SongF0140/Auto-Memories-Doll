import { MemoryService } from "./memory-service";
import { AuditService } from "./audit-service";
import { AuditReportWriter } from "./audit-report-writer";
import { Auditor } from "../../features/audit/auditor";
import { AuditReporter } from "../../features/audit/reporter";
import { QualityFilterService, SimilarMemoryHint } from "./quality-filter-service";
import { ModelAdapter } from "../../lib/ai/model-adapter";
import { MemoryRecord, MemoryKind, MemoryEvidence, PendingEvent } from "../../types/memory";
import { buildMemoryRecord, buildPendingEvent } from "../../lib/memory/builder";
import { validateMemoryRecord } from "../../lib/memory/validator";
import { buildVectorRecord } from "../../lib/vector/generator";
import { VectorIndex } from "../../lib/vector/index";
import { updateIndexMap } from "../../lib/storage/index-writer";
import { writeMemoryMarkdown, updateAgentMarkdown } from "../../lib/storage/memory-writer";
import { createFailureRecord, deleteFile } from "../../lib/storage/file-manager";
import { getNotePath } from "../../lib/storage/path-resolver";
import { processJsonPipeline } from "../pipelines/json-pipeline";
import { formatMemoryContent } from "../pipelines/formatter";
import { detectDuplicates } from "../pipelines/deduplicator";
import { MemoryValidationError } from "../../lib/errors";
import { generateId } from "../../lib/utils/id";
import { getCurrentTime } from "../../lib/utils/date";
import { logger } from "../../lib/logger";
import { VersionManager } from "../../features/audit/version-manager";

const LIST_LIMIT = 500;
const QUEUE_BATCH_SIZE = 100;
/**
 * 去重分页拉取的单批记忆条数。
 *
 * 现在去重会分页扫描全量正文，但每次只加载这一批，
 * 避免一次性把整库正文塞进内存。
 */
const DEDUP_SCAN_BATCH_SIZE = 500;
/** 向量语义去重阈值：cosine 相似度 ≥ 此值视为与现有记忆重复 */
const VECTOR_DEDUP_SIMILARITY = 0.95;
/** 相似记忆提示的最低相似度：太远的条目不给闸门看，节省 token */
const SIMILAR_HINT_MIN_SIMILARITY = 0.6;
/** 向量召回的 top-K 条数 */
const RECALL_TOP_K = 3;

/** 向量召回的单条相似命中 */
type SimilarHit = { memoryId: string; similarity: number; title: string; summary: string };

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
    meta?: { kind?: MemoryKind; evidence?: MemoryEvidence },
  ): Promise<string> {
    // 1. 预处理：清洗 + 去重 + 拆包
    const formattedContent = formatMemoryContent(content);
    const totalCount = this.memoryService.count(); // 资料库总量
    if (totalCount > DEDUP_SCAN_BATCH_SIZE) {
      logger.ingest.warn(
        `资料库已有 ${totalCount} 条记忆，去重将分页扫描全部正文内容。` +
          `如需更高性能，可升级为向量语义去重或优化去重索引。`,
      );
    }
    const duplicateCheck = this.detectDuplicateContent(formattedContent);
    if (duplicateCheck.isDuplicate) {
      throw new MemoryValidationError(
        "content",
        `内容与现有记忆高度重复（相似度 ${(duplicateCheck.similarity * 100).toFixed(1)}%），已拒绝入库`,
      );
    }

    const pipelineResult = await processJsonPipeline(formattedContent, []);

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
      undefined,
      meta,
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
      await this.auditReportWriter.write().catch((err) =>
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

        // 全入口统一的向量语义去重（processIngest 的 Jaccard 是写前快筛，此处兜底改写型重复）
        const similarHits = await this.recallSimilarMemories(candidate.content, event.memoryId);
        if (similarHits === null) {
          // fail-closed：embedding 失败时无法做语义去重，重复内容可能绕过保护静默入库 → 转人工
          event.status = "review";
          this.memoryService.updateEvent(event);
          await this.recordQualityFailure(
            event,
            "vector-recall",
            new Error("向量召回不可用，无法进行语义去重，转人工裁决"),
          );
          return;
        }
        const duplicate = similarHits.find((h) => h.similarity >= VECTOR_DEDUP_SIMILARITY);
        if (duplicate) {
          event.status = "rejected";
          this.memoryService.updateEvent(event);
          await this.recordQualityFailure(
            event,
            "vector-dedup",
            new Error(
              `与现有记忆《${duplicate.title}》高度相似（${(duplicate.similarity * 100).toFixed(1)}%），拒绝入库`,
            ),
          );
          return;
        }

        // 质量闸门：注入相似记忆上下文，让 LLM 能判断新颖性（是否与库内已有知识重合）
        const hints: SimilarMemoryHint[] = similarHits
          .filter((h) => h.similarity >= SIMILAR_HINT_MIN_SIMILARITY)
          .map((h) => ({ title: h.title, summary: h.summary, similarity: h.similarity }));
        const filterResult = await this.qualityFilter.filter(candidate, hints);
        if (filterResult.verdict !== "accept") {
          // reject → 终态拒绝不重试；review → 挂起待人工裁决（均不进 failed 重试循环）
          event.status = filterResult.verdict === "reject" ? "rejected" : "review";
          this.memoryService.updateEvent(event);
          await this.recordQualityFailure(
            event,
            "quality-filter",
            new Error(filterResult.reason || "质量未达标"),
          );
          return;
        }

        // 闸门判定的记忆类型回填到候选（非 fact 已在闸门内转为 review，不会走到这里）
        candidate.kind = filterResult.kind;

        const newId = await this.commitNewMemory(event, candidate);

        event.status = "done";
        this.memoryService.updateEvent(event);
        return newId;
      }

      // 更新路径：content 有实质变更时同样过质量闸门（防止借更新洗入低质内容）。
      // reject 终拒；review 时质量存疑——置标志禁用 auto_merge，审计结果改走逐字段人工冲突裁决。
      let updateQualityReview = false;
      if (event.changedFields.includes("content") && candidate.content) {
        const similarHits = await this.recallSimilarMemories(candidate.content, event.memoryId);
        let duplicate: SimilarHit | undefined;
        let hints: SimilarMemoryHint[] = [];
        if (similarHits === null) {
          // embedding 失败：语义去重与相似提示跳过；更新本身有 Auditor diff/冲突审计兜底，继续走审计
          logger.audit.warn("向量召回不可用，更新跳过语义去重与相似提示", {
            memoryId: event.memoryId,
          });
        } else {
          duplicate = similarHits.find((h) => h.similarity >= VECTOR_DEDUP_SIMILARITY);
          hints = similarHits
            .filter((h) => h.similarity >= SIMILAR_HINT_MIN_SIMILARITY)
            .map((h) => ({ title: h.title, summary: h.summary, similarity: h.similarity }));
        }
        if (duplicate) {
          event.status = "rejected";
          this.memoryService.updateEvent(event);
          await this.recordQualityFailure(
            event,
            "vector-dedup",
            new Error(
              `与现有记忆《${duplicate.title}》高度相似（${(duplicate.similarity * 100).toFixed(1)}%），拒绝入库`,
            ),
          );
          return;
        }
        const filterResult = await this.qualityFilter.filter(candidate, hints);
        if (filterResult.verdict === "reject") {
          event.status = "rejected";
          this.memoryService.updateEvent(event);
          await this.recordQualityFailure(
            event,
            "quality-filter",
            new Error(filterResult.reason || "质量未达标"),
          );
          return;
        }
        if (filterResult.verdict === "review") {
          updateQualityReview = true;
          logger.audit.warn("更新内容质量存疑，禁用 auto_merge，转人工冲突裁决", {
            memoryId: event.memoryId,
            reason: filterResult.reason,
          });
        }
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
          if (updateQualityReview) {
            // 质量存疑的更新禁 auto_merge：不写回任何变更，逐字段生成冲突转人工裁决
            // （对比 candidate 与 existing —— 人工裁决的正是"这次更新想改什么"）
            const changedFields = event.changedFields.filter((field) => {
              if (
                field === "version" ||
                field === "id" ||
                field === "createdAt" ||
                field === "updatedAt"
              ) {
                return false;
              }
              const key = field as keyof MemoryRecord;
              return JSON.stringify(candidate[key]) !== JSON.stringify(existing[key]);
            });
            for (const field of changedFields) {
              const key = field as keyof MemoryRecord;
              this.auditService.createConflict(
                event.memoryId,
                event.eventId,
                field,
                existing[key],
                candidate[key],
              );
            }
            event.status = "done";
            this.memoryService.updateEvent(event);
            return;
          }

          const merged = resolution.merged;
          this.memoryService.updateMemory(event.memoryId, merged);

          // 内容发生变更时重新生成向量
          if (event.changedFields.includes("content") && merged.content) {
            await this.refreshVector(event.memoryId, merged.content);
          }

          // SQLite 已更新（真源）；派生物同步失败不阻塞事件完成
          const updated = this.memoryService.getMemory(event.memoryId);
          if (updated) {
            if (event.changedFields.includes("content")) {
              try {
                this.memoryService.classifyMemory(event.memoryId, updated.content);
              } catch (err) {
                logger.ingest.error("记忆分类失败（不阻塞更新）", {
                  memoryId: event.memoryId,
                  error: (err as Error).message,
                });
              }
            }
            await this.syncDerivedStores(updated);
          } else {
            logger.ingest.error("auto_merge 后读取记忆为空，跳过派生同步", {
              memoryId: event.memoryId,
            });
          }
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

  /**
   * 向量召回 top-K 相似记忆（含标题/摘要），一次调用同时服务：
   * 1. 向量语义去重（相似度 ≥ VECTOR_DEDUP_SIMILARITY 判重）
   * 2. 质量闸门的新颖性参考上下文
   * 返回 null 表示召回不可用（模型降级 / 空内容 / embedding 失败）：
   * - 新建路径 fail-closed 转人工（防止重复内容绕过语义去重静默入库）
   * - 更新路径记日志后继续走审计（Auditor diff/冲突兜底）
   */
  private async recallSimilarMemories(
    content: string,
    excludeMemoryId?: string,
  ): Promise<SimilarHit[] | null> {
    if (ModelAdapter.isDegradedMode || !content) return null;

    try {
      const { embedding } = await ModelAdapter.generateEmbedding(content);
      const vectorIndex = new VectorIndex();
      try {
        return vectorIndex
          .search(embedding, RECALL_TOP_K)
          .filter((hit) => hit.memoryId !== excludeMemoryId)
          .map((hit) => {
            const memory = this.memoryService.getMemory(hit.memoryId);
            return memory
              ? {
                  memoryId: hit.memoryId,
                  similarity: hit.similarity,
                  title: memory.title,
                  summary: memory.summary,
                }
              : null;
          })
          .filter((hit): hit is NonNullable<typeof hit> => hit !== null);
      } finally {
        vectorIndex.close();
      }
    } catch (error) {
      logger.vector.warn("向量召回失败（不可判定，由调用方按 fail-closed 策略处理）:", {
        error: (error as Error).message,
      });
      return null;
    }
  }

  /**
   * 派生存储同步（Markdown / 话题 Agent.md / 索引）。
   *
   * SQLite 是真源：主存储提交成功后，派生物属于可重建的镜像/加速层，
   * 任一派生任务失败只记日志 + 归档失败记录，不向上抛 ——
   * 避免已入库记忆的事件被整条打成 failed，重试时错误地改走更新+审计路径。
   * 向量本就由 vector-worker 异步补偿，与此策略一致。
   */
  private async syncDerivedStores(memory: MemoryRecord | null): Promise<void> {
    if (!memory) {
      logger.ingest.error("派生存储同步跳过：主存储读取为空");
      return;
    }
    const all = this.memoryService.listMemories({ limit: LIST_LIMIT });
    const guard = (stage: string) => (err: unknown) => {
      logger.ingest.error(`派生存储同步失败（不阻塞入库）: ${stage}`, {
        memoryId: memory.id,
        error: (err as Error).message,
      });
      createFailureRecord(memory.id, stage, err as Error).catch(() => {});
    };
    await Promise.all([
      writeMemoryMarkdown(memory).catch(guard("write-memory-markdown")),
      updateAgentMarkdown(memory.topic, all).catch(guard("update-agent-markdown")),
      updateIndexMap(all).catch(guard("update-index-map")),
    ]);
  }

  /** 新建落盘：建 SQLite 记录（真源）+ 分类 + 派生同步。processEvent 与人工放行共用。 */
  private async commitNewMemory(event: PendingEvent, candidate: MemoryRecord): Promise<string> {
    if (candidate.id !== event.memoryId) {
      throw new MemoryValidationError(
        "id",
        `候选记忆 ID (${candidate.id}) 与队列 memoryId (${event.memoryId}) 不一致`,
      );
    }

    const newId = await this.memoryService.createMemoryRecord(candidate);
    // 分类是派生信息：失败只记日志，不影响已入库的记忆
    try {
      this.memoryService.classifyMemory(newId, candidate.content);
    } catch (err) {
      logger.ingest.error("记忆分类失败（不阻塞入库）", {
        memoryId: newId,
        error: (err as Error).message,
      });
    }
    await this.syncDerivedStores(this.memoryService.getMemory(newId) ?? candidate);
    return newId;
  }

  /** 质量类拒绝的统一归档：写 failures 记录，失败不阻塞主流程 */
  private async recordQualityFailure(
    event: PendingEvent,
    stage: string,
    error: Error,
  ): Promise<void> {
    await createFailureRecord(event.memoryId, stage, error).catch((err) =>
      logger.audit.error("Failure record creation failed", { error: (err as Error).message }),
    );
  }

  /**
   * 人工裁决 review 状态的事件（质量闸门转人工的出口）。
   * - accept: 人工确认有价值，跳过闸门直接落盘
   * - reject: 终态拒绝并归档失败记录
   */
  async resolveReviewEvent(eventId: string, action: "accept" | "reject"): Promise<PendingEvent> {
    const event = this.memoryService.getEvent(eventId);
    if (!event) throw new Error(`事件不存在: ${eventId}`);
    if (event.status !== "review") throw new Error(`事件不在待审状态（当前: ${event.status}）`);
    const candidate = this.parseCandidate(event);

    if (action === "reject") {
      event.status = "rejected";
      this.memoryService.updateEvent(event);
      await this.recordQualityFailure(event, "review-decision", new Error("人工裁决：拒绝入库"));
      return event;
    }

    event.status = "processing";
    this.memoryService.updateEvent(event);
    try {
      await this.commitNewMemory(event, candidate);
      event.status = "done";
      this.memoryService.updateEvent(event);
    } catch (error) {
      event.status = "failed";
      event.retryCount++;
      this.memoryService.updateEvent(event);
      throw error;
    }
    return event;
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

  /** 待人工裁决的 review 事件列表 */
  getReviewEvents(limit?: number): PendingEvent[] {
    return this.memoryService.getEventsByStatus("review", limit);
  }

  private detectDuplicateContent(formattedContent: string): {
    isDuplicate: boolean;
    similarity: number;
  } {
    let offset = 0;

    while (true) {
      const batch = this.memoryService.listMemoryContents({
        limit: DEDUP_SCAN_BATCH_SIZE,
        offset,
      });

      if (batch.length === 0) {
        return { isDuplicate: false, similarity: 0 };
      }

      const duplicateCheck = detectDuplicates(formattedContent, batch);
      if (duplicateCheck.isDuplicate) {
        return duplicateCheck;
      }

      offset += batch.length;
    }
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
