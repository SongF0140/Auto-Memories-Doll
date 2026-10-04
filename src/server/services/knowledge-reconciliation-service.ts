import { z } from "zod";
import type { MemoryKind } from "../../types/memory";
import { ModelAdapter } from "../../lib/ai/model-adapter";
import { logger } from "../../lib/logger";
import type { TurnAnalysisCard } from "./memory-extraction-service";

export type { TurnAnalysisCard };

/** 召回的既有候选卡（完整卡，非仅标题摘要） */
export type ReconciliationCandidate = {
  memoryId: string;
  title: string;
  summary: string;
  content: string;
};

/** 召回函数：按语义取最多 5 张完整候选卡；null 表示召回不可用 */
export type ReconciliationRecall = (content: string) => Promise<ReconciliationCandidate[] | null>;

/** 补充精修产出的完整卡（非机械追加，模型合并既有卡与新信息后重写） */
export type RefinedCard = {
  title: string;
  summary: string;
  content: string;
  tags: string[];
  kind: MemoryKind;
  topic: string;
};

/** 逐卡协调决策 */
export type CardReconciliation =
  | { decision: "duplicate"; targetId: string; reason: string }
  | { decision: "supplement"; targetId: string; refined: RefinedCard; reason: string }
  /** new.review=true：无依据 assistant/mixed 断言，转人工确认 */
  | { decision: "new"; review: boolean; reason: string }
  /** 冲突不覆盖既有卡，转待确认 */
  | { decision: "conflict"; targetId: string; reason: string };

export type ReconciliationOk = {
  type: "ok";
  decisions: CardReconciliation[];
  /** 独立新知识（自动可入库）计数 */
  acceptedCount: number;
  /** 需人工确认（review 新增 / supplement / conflict）计数 */
  pendingCount: number;
  /** 语义重复（信息已在库，不产新卡）计数 */
  duplicateCount: number;
};

export type ReconciliationResult = ReconciliationOk | { type: "unavailable"; reason: string };

/** 召回候选上限：一次协调最多看 5 张完整卡 */
const RECONCILE_CANDIDATE_LIMIT = 5;
/** 非标准输出最大重试次数（与抽取/分析一致） */
const MAX_PARSE_ATTEMPTS = 2;

/** 模型输出层 schema：逐字段受校验，注入文本无法绕过 */
const refinedCardSchema = z.object({
  title: z.string().min(1),
  summary: z.string(),
  content: z.string().min(1),
  tags: z.array(z.string()).default([]),
  kind: z.enum(["fact", "inference", "hypothesis", "insight", "synthesis"]),
  topic: z.string().min(1),
});

const decisionSchema = z.discriminatedUnion("decision", [
  z.object({
    decision: z.literal("duplicate"),
    targetId: z.string().min(1),
    reason: z.string().min(1),
  }),
  z.object({
    decision: z.literal("supplement"),
    targetId: z.string().min(1),
    refined: refinedCardSchema,
    reason: z.string().min(1),
  }),
  z.object({
    decision: z.literal("new"),
    review: z.boolean().default(false),
    reason: z.string().min(1),
  }),
  z.object({
    decision: z.literal("conflict"),
    targetId: z.string().min(1),
    reason: z.string().min(1),
  }),
]);

const reconciliationSchema = z.object({
  decisions: z.array(decisionSchema),
});

/**
 * KnowledgeReconciliationService — 逐知识匹配、融合精修与冲突审核（第十一块）。
 *
 * 相似度只用于召回候选（上限 5 张完整卡），重复/补充/新建/冲突由模型逐卡判定，
 * 取代旧管线 cosine≥0.95 直接拒绝的捷径。契约硬约束（违反判解析失败重试）：
 * - targetId 必须来自本次召回集合（模型不可虚构目标）
 * - 同一轮对同一目标的 supplement 至多一条（同轮补充必须合并为一张完整精修卡）
 * - decisions 数量必须等于输入卡数
 */
export class KnowledgeReconciliationService {
  async reconcile(
    cards: TurnAnalysisCard[],
    recall: ReconciliationRecall,
  ): Promise<ReconciliationResult> {
    if (ModelAdapter.isDegradedMode) {
      return { type: "unavailable", reason: "模型降级或未配置 API Key，无法进行知识协调" };
    }
    if (cards.length === 0) {
      return { type: "ok", decisions: [], acceptedCount: 0, pendingCount: 0, duplicateCount: 0 };
    }

    // 召回合并去重：多卡各自召回后共享同一候选集合（一轮一次语义检索成本可控）
    const candidates = new Map<string, ReconciliationCandidate>();
    for (const card of cards) {
      const hits = await recall(card.content);
      if (!hits) continue; // 召回不可用按无候选处理，由模型判 new
      for (const hit of hits.slice(0, RECONCILE_CANDIDATE_LIMIT)) {
        if (!candidates.has(hit.memoryId)) candidates.set(hit.memoryId, hit);
      }
    }
    const candidateList = [...candidates.values()].slice(0, RECONCILE_CANDIDATE_LIMIT);

    const prompt = this.buildPrompt(cards, candidateList);

    for (let attempt = 1; attempt <= MAX_PARSE_ATTEMPTS; attempt++) {
      let response;
      try {
        response = await ModelAdapter.generate(prompt, "flagship");
      } catch (error) {
        return { type: "unavailable", reason: `知识协调模型调用失败：${(error as Error).message}` };
      }

      const parsed = this.parseDecisions(response.content, cards.length, candidateList);
      if (!parsed) {
        logger.quality.warn("知识协调输出无法通过契约校验，重试", {
          attempt,
          output: response.content.slice(0, 200),
        });
        continue;
      }

      const decisions = this.enforceNewReview(parsed, cards);

      let acceptedCount = 0;
      let pendingCount = 0;
      let duplicateCount = 0;
      for (const decision of decisions) {
        if (decision.decision === "duplicate") duplicateCount += 1;
        else if (decision.decision === "new" && !decision.review) acceptedCount += 1;
        else pendingCount += 1;
      }
      return { type: "ok", decisions, acceptedCount, pendingCount, duplicateCount };
    }

    return {
      type: "unavailable",
      reason: `知识协调输出 ${MAX_PARSE_ATTEMPTS} 次均无法通过契约校验，本轮候选转待确认`,
    };
  }

  /** 无依据 assistant/mixed 新增断言强制 review——按卡元数据修正，不信任模型自报 */
  private enforceNewReview(
    decisions: CardReconciliation[],
    cards: TurnAnalysisCard[],
  ): CardReconciliation[] {
    return decisions.map((decision, index) => {
      if (decision.decision !== "new" || decision.review) return decision;
      const card = cards[index];
      const withoutEvidence = !card.evidence || !card.evidence.verified;
      if ((card.source === "assistant" || card.source === "mixed") && withoutEvidence) {
        return { ...decision, review: true };
      }
      return decision;
    });
  }

  /** 契约校验：数量一致 + targetId 全部在召回集合内 + 同目标 supplement 唯一 */
  private parseDecisions(
    text: string,
    expectedCount: number,
    candidates: ReconciliationCandidate[],
  ): CardReconciliation[] | null {
    const json = this.extractJsonObject(text);
    if (!json) return null;
    try {
      const parsed = reconciliationSchema.safeParse(JSON.parse(json));
      if (!parsed.success) return null;
      const decisions = parsed.data.decisions;
      if (decisions.length !== expectedCount) return null;

      const recalledIds = new Set(candidates.map((c) => c.memoryId));
      const supplementTargets = new Set<string>();
      for (const decision of decisions) {
        if (decision.decision === "new") continue;
        if (!recalledIds.has(decision.targetId)) return null; // 未召回 ID 拒绝
        if (decision.decision === "supplement") {
          if (supplementTargets.has(decision.targetId)) return null; // 同轮同目标必须合并
          supplementTargets.add(decision.targetId);
        }
      }
      return decisions;
    } catch {
      return null;
    }
  }

  private buildPrompt(cards: TurnAnalysisCard[], candidates: ReconciliationCandidate[]): string {
    const candidateBlock =
      candidates.length > 0
        ? candidates
            .map(
              (c, i) =>
                `[${i + 1}] id=${c.memoryId}\n标题：${c.title}\n摘要：${c.summary}\n正文：${c.content}`,
            )
            .join("\n\n")
        : "（无召回候选）";

    const cardBlock = cards
      .map(
        (c, i) =>
          `[卡${i + 1}] 标题：${c.title}\n摘要：${c.summary}\n正文：${c.content}\n来源：${c.source}（证据：${c.evidence ? `有，已验证` : `无`}）`,
      )
      .join("\n\n");

    return `你是记忆库的知识协调编辑。下面是本轮新增的知识卡和库中召回的相似既有卡。逐卡判断两者关系，输出决策数组。

决策规则（每张输入卡恰好一条决策，顺序与输入一致）：
1. duplicate：新卡信息已完全包含在某张既有卡中，无任何新信息。{"decision":"duplicate","targetId":"<既有卡id>","reason":"中文原因"}
2. supplement：相似但新卡带来了既有卡没有的新信息。必须输出合并后的完整精修卡（把既有卡正文与新信息融合重写为一张更完整的卡，禁止机械拼接或只追加一句话）。同一既有卡在整轮中至多一条 supplement——多张新卡补充同一目标时，合并为一条精修卡。{"decision":"supplement","targetId":"...","refined":{"title","summary","content","tags":[],"kind":"fact|inference|hypothesis|insight|synthesis","topic":"tech|life|work|study|health|finance|social|entertainment|uncategorized"},"reason":"补充了什么"}
3. new：独立新知识，与召回候选无实质关联。无原文证据支撑的 assistant/mixed 断言必须 review:true。{"decision":"new","review":false,"reason":"为什么是新知识"}
4. conflict：新卡与既有卡对同一事实给出矛盾说法。不得覆盖既有卡。{"decision":"conflict","targetId":"...","reason":"矛盾点"}

硬性约束：
- targetId 必须从下方召回候选的 id 中选取，禁止编造；选 new 则不需要 targetId。
- decisions 数组长度必须等于输入卡数量。
- 全部用简体中文，专有名词保留原文。

召回候选（${candidates.length} 张）：
${candidateBlock}

本轮新增知识卡（${cards.length} 张）：
${cardBlock}

只回复 JSON：{"decisions":[...]}`;
  }

  private extractJsonObject(text: string): string | null {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) return null;
    return text.slice(start, end + 1);
  }
}
