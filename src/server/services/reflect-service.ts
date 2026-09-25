import { VectorRetriever } from "../../lib/vector/retriever";
import { MemoryService } from "./memory-service";
import { ModelAdapter } from "../../lib/ai/model-adapter";
import { logger } from "../../lib/logger";

/**
 * Reflect 式推理闭环（对标 Hindsight 第三操作 reflect，优先级 #4）：
 * 检索 → 对命中的记忆做 disposition-aware 推理 → 产出带依据标注的答案。
 *
 * 与 chat 的区别：chat 是"用记忆回答用户"，reflect 是"对记忆本身做推理"
 * （发现矛盾、归纳结论、检验前提），产物回答供外部 agent / 前端直接消费。
 *
 * 红线：纯只读——不写 accessCount / retrievalCount，不落任何新卡
 * （推理产物的沉淀走用户显式路径，不自动入库）。
 */

export type ReflectDisposition = "balanced" | "skeptical" | "literal" | "empathetic";

export type ReflectResult = {
  query: string;
  disposition: ReflectDisposition;
  /** LLM 推理产出；degraded 时为提示文案 */
  answer: string;
  /** 推理所依据的记忆 id（与检索命中一致） */
  usedMemoryIds: string[];
  memories: { id: string; title: string; summary: string; similarity: number }[];
  /** true = LLM 降级，answer 不可用但检索结果仍有效 */
  degraded: boolean;
};

/** 送入推理的卡片上限：超出后 LLM 上下文成本陡增且边际收益低 */
const REFLECT_CONTEXT_LIMIT = 12;
/** 单卡正文截断：推理看摘要 + 关键正文即可，全文经 get_memory 按需取 */
const REFLECT_CARD_CONTENT_LIMIT = 1_200;

const DISPOSITION_INSTRUCTIONS: Record<ReflectDisposition, string> = {
  balanced: "以平衡视角推理：既采纳卡片中的明确结论，也对单薄证据保持保留。",
  skeptical:
    "以怀疑视角推理：逐条审视卡片的可信度（来源是否单一、是否与其它卡片冲突、结论是否超出证据），" +
    "只在证据充分时下结论，可疑之处明确指出。",
  literal: "以字面视角推理：只依据卡片字面陈述作答，不做任何引申或补全，卡片没说的就是不知道。",
  empathetic:
    "以共情视角推理：除结论外，关注卡片背后反映的用户意图、偏好与处境，在回答中点明这些线索。",
};

export type ReflectServiceDeps = {
  retriever?: Pick<VectorRetriever, "searchDetailed" | "close">;
  memoryService?: Pick<MemoryService, "getMemoriesByIds" | "close">;
};

export class ReflectService {
  private retriever: Pick<VectorRetriever, "searchDetailed" | "close">;
  private memoryService: Pick<MemoryService, "getMemoriesByIds" | "close">;

  constructor(deps: ReflectServiceDeps = {}) {
    this.memoryService = deps.memoryService ?? new MemoryService();
    this.retriever = deps.retriever ?? new VectorRetriever();
  }

  async reflect(
    query: string,
    disposition: ReflectDisposition = "balanced",
    limit = 6,
  ): Promise<ReflectResult> {
    const search = await this.retriever.searchDetailed(query, Math.min(limit, REFLECT_CONTEXT_LIMIT));
    const cards = this.memoryService.getMemoriesByIds(search.results.map((r) => r.memoryId));
    const byId = new Map(cards.map((c) => [c.id, c]));
    // 检索命中但已不在库中的 id（竞态删除）静默丢弃
    const memories: { card: MemoryRecordLike; similarity: number }[] = [];
    for (const r of search.results) {
      const card = byId.get(r.memoryId);
      if (card) memories.push({ card, similarity: r.similarity });
    }

    const result: ReflectResult = {
      query,
      disposition,
      answer: "",
      usedMemoryIds: memories.map((m) => m.card.id),
      memories: memories.map((m) => ({
        id: m.card.id,
        title: m.card.title,
        summary: m.card.summary,
        similarity: m.similarity,
      })),
      degraded: false,
    };

    if (memories.length === 0) {
      result.answer = "记忆库中没有与该问题相关的记忆，无法推理。";
      return result;
    }

    if (ModelAdapter.isDegradedMode) {
      // fail-soft：推理不可用时仍返回检索结果（degraded 标记），调用方可自行基于卡片作答
      result.degraded = true;
      result.answer = "模型降级中，推理暂不可用；已返回相关记忆卡片供调用方自行分析。";
      return result;
    }

    result.answer = await this.reason(query, disposition, memories);
    return result;
  }

  /** 构造 disposition-aware 推理 prompt 并调用旗舰模型 */
  private async reason(
    query: string,
    disposition: ReflectDisposition,
    memories: { card: MemoryRecordLike; similarity: number }[],
  ): Promise<string> {
    const cardBlock = memories
      .map(
        (m, i) =>
          `[${i + 1}] 《${m.card.title}》(id: ${m.card.id})\n` +
          `摘要：${m.card.summary}\n` +
          `正文：${m.card.content.slice(0, REFLECT_CARD_CONTENT_LIMIT)}`,
      )
      .join("\n\n");

    const prompt = `你是记忆推理引擎。下面是从用户本机记忆库检索出的、与问题相关的记忆卡片。
${DISPOSITION_INSTRUCTIONS[disposition]}
推理规则：
1. 只依据卡片内容推理，不引入卡片之外的背景知识；结论后用（卡: <id>）标注依据。
2. 卡片之间存在矛盾时，明确指出矛盾并列出双方证据，不要强行调和。
3. 证据不足以回答时，明确说"记忆不足以回答"，并说明缺少什么信息。
4. 用简体中文回答，直接给结论与依据，不要复述卡片。

问题：${query}

记忆卡片：
${cardBlock}`;

    try {
      const response = await ModelAdapter.generate(prompt, "flagship");
      return response.content;
    } catch (error) {
      logger.api.warn("Reflect 推理调用失败", { error: (error as Error).message });
      return `推理调用失败：${(error as Error).message}。相关记忆卡片已随结果返回。`;
    }
  }

  close(): void {
    this.retriever.close();
    this.memoryService.close();
  }
}

/** 反射只消费 MemoryRecord 的只读子集，最小化依赖面（便于测试注入） */
type MemoryRecordLike = {
  id: string;
  title: string;
  summary: string;
  content: string;
};
