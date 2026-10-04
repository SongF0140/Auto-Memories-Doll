import { ConversationLearningService } from "../services/conversation-learning-service";
import { MemoryExtractionService } from "../services/memory-extraction-service";
import type {
  TurnAnalysisInput,
  TurnAnalysisResult,
  TurnReconciliationSummary,
} from "../services/memory-extraction-service";
import {
  KnowledgeReconciliationService,
  type ReconciliationOk,
  type TurnAnalysisCard,
} from "../services/knowledge-reconciliation-service";
import { MemoryService } from "../services/memory-service";
import { ModelAdapter } from "../../lib/ai/model-adapter";
import { VectorIndex } from "../../lib/vector/index";
import { logger } from "../../lib/logger";

/** worker 可调参数：轮询间隔（默认 10s），测试可注入小值 */
export type ConversationLearningWorkerDeps = {
  pollIntervalMs?: number;
};

/** 逐卡协调召回上限（完整卡） */
const LEARNING_RECALL_TOP_K = 5;

/**
 * ConversationLearningWorker — 按现有后台 worker 生命周期消费学习任务。
 *
 * 第十块：默认装配真实处理器链（MemoryExtractionService.analyzeTurn，
 * 内含白名单话题分类与逐卡证据校验）。
 * 第十一块：knowledge 结果的 auto 卡再经 KnowledgeReconciliationService 逐知识协调
 * （duplicate/supplement/new/conflict），决策经 stage 通路落候选：
 * new(自动) → stageCreateMemory；supplement → stageUpdateMemory（既有卡审计更新）；
 * conflict/review-new → 同样落 create 候选交闸门/审计判 review（人工队列分流由 UI 块承接）。
 * manual 卡不参与协调，仅保留在 result_json。
 * 启动时恢复被中断的 processing 任务为 queued；失败任务不自动重试。
 */
export class ConversationLearningWorker {
  private service: ConversationLearningService;
  private analyzer: MemoryExtractionService;
  private reconciler: KnowledgeReconciliationService;
  private memoryService: MemoryService;
  private pollIntervalMs: number;
  private isRunning = false;

  constructor(deps: ConversationLearningWorkerDeps = {}) {
    this.service = new ConversationLearningService();
    this.analyzer = new MemoryExtractionService();
    this.reconciler = new KnowledgeReconciliationService();
    this.memoryService = new MemoryService();
    this.pollIntervalMs = deps.pollIntervalMs ?? 10_000;
    this.service.setProcessor((task) => this.processTask(task));
  }

  /** 处理器链：价值判断 → auto 卡逐知识协调 → stage 落候选 */
  private async processTask(task: TurnAnalysisInput): Promise<TurnAnalysisResult> {
    const analysis = await this.analyzer.analyzeTurn(task);
    if (analysis.type !== "knowledge") return analysis;

    const autoCards = analysis.items.filter((card) => card.reviewStatus === "auto");
    let reconciliation: TurnReconciliationSummary;
    if (autoCards.length === 0) {
      reconciliation = { duplicates: 0, accepted: 0, pending: 0 };
    } else {
      const outcome = await this.reconciler.reconcile(autoCards, (content) =>
        this.recallCandidates(content),
      );
      if (outcome.type === "ok") {
        this.land(outcome, autoCards);
        reconciliation = {
          duplicates: outcome.duplicateCount,
          accepted: outcome.acceptedCount,
          pending: outcome.pendingCount,
        };
      } else {
        logger.audit.warn("知识协调不可用，本轮 auto 卡仅保留在任务结果", {
          turnId: task.turnId,
          reason: outcome.reason,
        });
        reconciliation = {
          duplicates: 0,
          accepted: 0,
          pending: autoCards.length,
          unavailableReason: outcome.reason,
        };
      }
    }
    return { ...analysis, reconciliation };
  }

  /** 决策落候选（stage 通路）：单条失败不中断其余落库，审计日志记录 */
  private land(outcome: ReconciliationOk, autoCards: TurnAnalysisCard[]): void {
    for (let index = 0; index < outcome.decisions.length; index++) {
      const decision = outcome.decisions[index];
      const card = autoCards[index];
      try {
        if (decision.decision === "duplicate") continue; // 信息已在库，不产新卡
        if (decision.decision === "supplement") {
          this.memoryService.stageUpdateMemory(decision.targetId, {
            title: decision.refined.title,
            summary: decision.refined.summary,
            content: decision.refined.content,
            tags: decision.refined.tags,
            kind: decision.refined.kind,
            topic: decision.refined.topic,
          });
          continue;
        }
        // new（自动或转审）与 conflict：新断言落 create 候选，经既有闸门/审计通路裁决
        this.memoryService.stageCreateMemory(
          "对话学习",
          "chat",
          card.title,
          card.content,
          card.summary,
          card.tags,
          card.topic,
          undefined,
          undefined,
          {
            kind: card.kind,
            evidence: card.evidence
              ? { text: card.evidence.text, location: `学习任务 auto 卡` }
              : undefined,
          },
        );
      } catch (error) {
        logger.audit.warn("学习候选落库失败（不中断其余决策）", {
          decision: decision.decision,
          error: (error as Error).message,
        });
      }
    }
  }

  /** 向量召回完整候选卡（上限 5）：embedding/索引不可用时返回 null，由协调按无候选处理 */
  private async recallCandidates(
    content: string,
  ): Promise<Array<{ memoryId: string; title: string; summary: string; content: string }> | null> {
    if (ModelAdapter.isDegradedMode || !content) return null;
    try {
      const { embedding } = await ModelAdapter.generateEmbedding(content);
      const vectorIndex = new VectorIndex();
      const hits = vectorIndex
        .search(embedding, LEARNING_RECALL_TOP_K)
        .map((hit) => {
          const memory = this.memoryService.getMemory(hit.memoryId);
          return memory
            ? {
                memoryId: memory.id,
                title: memory.title,
                summary: memory.summary,
                content: memory.content,
              }
            : null;
        })
        .filter((hit): hit is NonNullable<typeof hit> => hit !== null);
      return hits;
    } catch (error) {
      logger.audit.warn("学习召回不可用，按无候选处理", { error: (error as Error).message });
      return null;
    }
  }

  async start(): Promise<void> {
    this.isRunning = true;
    try {
      const recovered = this.service.recoverInterruptedTasks();
      if (recovered > 0) {
        logger.chat.info(`恢复 ${recovered} 个被中断的学习任务为 queued`);
      }
    } catch (error) {
      logger.chat.error("学习任务中断恢复失败（不阻塞启动）", {
        error: (error as Error).message,
      });
    }
    await this.processLoop();
  }

  stop(): void {
    this.isRunning = false;
  }

  private async processLoop(): Promise<void> {
    while (this.isRunning) {
      try {
        await this.service.processNextLearningTask();
      } catch (error) {
        logger.chat.error("Learning worker error:", { error: (error as Error).message });
      }
      await this.sleep(this.pollIntervalMs);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
