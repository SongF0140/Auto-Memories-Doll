import { z } from "zod";
import { MemoryRecord, MemoryKind } from "../../types/memory";
import type { ChatMode } from "../../types/api";
import { ModelAdapter } from "../../lib/ai/model-adapter";
import { SimilarMemoryHint } from "./quality-filter-service";
import { TopicClassificationService } from "./topic-classification-service";
import { logger } from "../../lib/logger";

/** 抽取产出的一张原子记忆卡片（全部为中文人可读内容） */
export type ExtractedCard = {
  title: string;
  summary: string;
  content: string;
  tags: string[];
  /**
   * I-11 使用场景："当用户问 X / 做 Y 时这条记忆有用"。
   * 与 summary 共同构成 embedding 键（Rainy window-use 分离），使召回语义对齐查询。
   */
  windowUse?: string;
  /**
   * 实体层（对标 Hindsight entity 抽取）：卡片涉及的关键实体
   * （工具名、库名、技术、文件路径、命令、配置项等），保留原文写法。
   * 实体共现边在检索 multi-hop 时用于跨卡扩展。
   */
  entities: string[];
  /**
   * batch 内因果依赖（对标 Hindsight causal link）：本卡结论建立在本次抽取的
   * 第几张卡之上（1 起始的序号）。commit 时由 orchestrator 解析为 memoryId。
   */
  causedBy: number[];
  /**
   * 跨源因果依赖（v2）：本卡结论建立在知识库已有条目之上，引用注入 prompt 的
   * 相似条目编号（1 起始）。commit 时由 orchestrator 经 hints 解析为存量 memoryId。
   * 老输出缺失时容错为空数组。
   */
  causedByExisting: number[];
};

/** 单次抽取最多产出的卡片数：防止 LLM 失控拆出几十张导致成本爆炸 */
const MAX_CARDS = 8;
/** 送入 LLM 的原文上限：需要完整保留博客/长文档级别的细节，24k 字符以内不截断 */
const PROMPT_CONTENT_LIMIT = 24_000;
/** 单卡正文的硬上限：保留长日志与长文，但避免单条记忆无限膨胀。 */
const CARD_CONTENT_LIMIT = 20_000;
/** 非标准输出时的最大重试次数 */
const MAX_PARSE_ATTEMPTS = 2;

/** 学习分析的单轮输入上限：超限需人工处理，不得截断后分析 */
const TURN_INPUT_LIMIT = 24_000;
/** 学习分析的历史消歧上下文上限 */
const TURN_HISTORY_LIMIT = 2_000;

// ── 第十块：对话轮次分析契约（路线图 3.2 判别联合 skip/knowledge/unavailable） ──

export type TurnEvidenceSourceRole = "user" | "assistant";

/** 逐卡来源证据：模型声称的原文片段 + 是否通过逐字子串校验 */
export type TurnCardEvidence = {
  sourceRole: TurnEvidenceSourceRole;
  text: string;
  verified: boolean;
};

/** 分析产出的一张候选知识卡：已做证据校验、来源判定与白名单话题分类 */
export type TurnAnalysisCard = {
  title: string;
  summary: string;
  content: string;
  tags: string[];
  source: "user" | "assistant" | "mixed";
  kind: MemoryKind;
  topic: string;
  evidence: TurnCardEvidence | null;
  /** auto=证据充分可走自动管线；manual=无证据/伪造证据，强制人工确认 */
  reviewStatus: "auto" | "manual";
  reviewReason?: string;
};

/** 第十一块：worker 接线后附加的逐知识协调摘要（已接受/待确认分开计数） */
export type TurnReconciliationSummary = {
  duplicates: number;
  accepted: number;
  pending: number;
  /** 协调不可用时记录原因（决策未产出，候选保留在 items 中） */
  unavailableReason?: string;
};

/** 轮次分析判别联合：skip 无知识（必带原因）；knowledge 非空拆卡；unavailable 模型/输入不可用 */
export type TurnAnalysisResult =
  | { type: "skip"; reason: string }
  | { type: "knowledge"; items: TurnAnalysisCard[]; reconciliation?: TurnReconciliationSummary }
  | { type: "unavailable"; reason: string };

/** 一次学习任务消费的输入：仅本轮 user/assistant 文本 */
export type TurnAnalysisInput = {
  turnId: string;
  sessionId: string;
  mode: ChatMode;
  userText: string;
  assistantText: string;
};

/** 抽取结果显式三态：空结果与错误不混淆（替代旧 null 的多重含义） */
export type ExtractionResult =
  | { status: "ok"; cards: ExtractedCard[] }
  | { status: "empty"; reason: string }
  | { status: "unavailable"; reason: string };

/** 模型输出层 schema：逐字段受校验，注入文本无法绕过（缺失字段/越界枚举直接判解析失败） */
const turnEvidenceSchema = z.object({
  sourceRole: z.enum(["user", "assistant"]),
  text: z.string().min(1),
});

const turnCardSchema = z.object({
  title: z.string().min(1),
  summary: z.string(),
  content: z.string().min(1),
  tags: z.array(z.string()).default([]),
  source: z.enum(["user", "assistant", "mixed"]),
  kind: z.enum(["fact", "inference", "hypothesis", "insight", "synthesis"]),
  suggestedTopic: z.string().default(""),
  evidence: turnEvidenceSchema.nullable().default(null),
});

const turnAnalysisSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("skip"), reason: z.string().min(1) }),
  z.object({ type: z.literal("knowledge"), cards: z.array(turnCardSchema).min(1) }),
]);

/**
 * 记忆抽取服务：把采集来的原始内容（英文 / markdown 源码 / 会话日志的混合体）
 * 按"一个话题一张卡片"拆分，并将每张卡片全文重写为简体中文。
 *
 * 这是"原文直存"与"人可读知识卡"的分界线：质量闸门只判断值不值得存，
 * 本服务负责决定"怎么存才易读"。失败时返回显式 unavailable（fail-closed 转人工），
 * 绝不把半成品入库；"无内容可拆"返回显式 empty——空结果与错误不混淆。
 */
export class MemoryExtractionService {
  private topicClassifier: TopicClassificationService;

  constructor() {
    this.topicClassifier = new TopicClassificationService();
  }

  async extract(
    candidate: MemoryRecord,
    similar: SimilarMemoryHint[] = [],
  ): Promise<ExtractionResult> {
    // 模型降级时无法改写 → 转人工（与质量闸门同一 fail-closed 策略）
    if (ModelAdapter.isDegradedMode) {
      return { status: "unavailable", reason: "模型降级或未配置 API Key，无法抽取" };
    }

    const prompt = this.buildPrompt(candidate, similar);

    for (let attempt = 1; attempt <= MAX_PARSE_ATTEMPTS; attempt++) {
      try {
        const response = await ModelAdapter.generate(prompt, "flagship");
        const parsed = this.parseCards(response.content, candidate.content, similar.length);
        if (parsed.status === "ok") return { status: "ok", cards: parsed.cards };
        if (parsed.status === "empty") {
          return { status: "empty", reason: "模型判定内容中没有可拆的知识卡片" };
        }
        logger.quality.warn("抽取输出非标准 JSON，重试", {
          attempt,
          output: response.content.slice(0, 200),
        });
      } catch (error) {
        logger.quality.warn("记忆抽取调用失败", { error: (error as Error).message });
        return { status: "unavailable", reason: `抽取模型调用失败：${(error as Error).message}` };
      }
    }

    return { status: "unavailable", reason: `抽取输出 ${MAX_PARSE_ATTEMPTS} 次均无法解析` };
  }

  /**
   * 对话轮次价值判断（第十块）：判断本轮对话是否包含长期知识，
   * 有则拆分为原子知识卡并逐卡做证据校验、来源/kind 判定与白名单话题分类。
   * 输入超限、降级、调用失败或解析耗尽都显式返回 unavailable——不伪装 skip、不静默截断。
   */
  async analyzeTurn(task: TurnAnalysisInput, recentHistory?: string): Promise<TurnAnalysisResult> {
    if (ModelAdapter.isDegradedMode) {
      return { type: "unavailable", reason: "模型降级或未配置 API Key，无法进行学习分析" };
    }

    const inputLength = task.userText.length + task.assistantText.length;
    if (inputLength > TURN_INPUT_LIMIT) {
      return {
        type: "unavailable",
        reason: `本轮对话输入 ${inputLength} 字符超过 ${TURN_INPUT_LIMIT} 上限，需人工处理，未做部分分析`,
      };
    }

    const prompt = this.buildTurnPrompt(task, recentHistory);

    for (let attempt = 1; attempt <= MAX_PARSE_ATTEMPTS; attempt++) {
      let response;
      try {
        response = await ModelAdapter.generate(prompt, "flagship");
      } catch (error) {
        return {
          type: "unavailable",
          reason: `学习分析模型调用失败：${(error as Error).message}`,
        };
      }

      const parsed = this.parseTurnAnalysis(response.content);
      if (!parsed) {
        logger.quality.warn("对话分析输出无法通过 schema 校验，重试", {
          attempt,
          output: response.content.slice(0, 200),
        });
        continue;
      }
      if (parsed.type === "skip") return parsed;

      // 上限校验：超限不 slice 后静默保存，整轮标明需人工处理
      if (parsed.cards.length > MAX_CARDS) {
        return {
          type: "unavailable",
          reason: `模型输出 ${parsed.cards.length} 张知识卡超过 ${MAX_CARDS} 张上限，需人工处理，未写入部分结果`,
        };
      }
      const oversized = parsed.cards.find((card) => card.content.length > CARD_CONTENT_LIMIT);
      if (oversized) {
        return {
          type: "unavailable",
          reason: `知识卡「${oversized.title}」正文 ${oversized.content.length} 字符超过 ${CARD_CONTENT_LIMIT} 上限，需人工处理，未写入部分结果`,
        };
      }

      const items: TurnAnalysisCard[] = [];
      for (const card of parsed.cards) {
        items.push(await this.buildTurnCard(card, task));
      }
      return { type: "knowledge", items };
    }

    return {
      type: "unavailable",
      reason: `模型输出 ${MAX_PARSE_ATTEMPTS} 次均无法通过 schema 校验，学习分析不可用`,
    };
  }

  /** 解析模型输出为判别联合；任何结构异常返回 null（由调用方重试后转 unavailable） */
  private parseTurnAnalysis(text: string): z.infer<typeof turnAnalysisSchema> | null {
    const json = this.extractJsonObject(text);
    if (!json) return null;
    try {
      const parsed = turnAnalysisSchema.safeParse(JSON.parse(json));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  /** 逐卡构建：证据逐字校验 → 无证据/伪造证据强制 manual + kind 降为 inference → 白名单话题分类 */
  private async buildTurnCard(
    card: z.infer<typeof turnCardSchema>,
    task: TurnAnalysisInput,
  ): Promise<TurnAnalysisCard> {
    const evidenceText = card.evidence?.text.trim() ?? "";
    const sourceText =
      card.evidence?.sourceRole === "assistant" ? task.assistantText : task.userText;
    const verified = evidenceText.length > 0 && sourceText.includes(evidenceText);

    const classified = await this.topicClassifier.classify({
      title: card.title,
      summary: card.summary,
      content: card.content,
      suggestedTopic: card.suggestedTopic,
    });

    const base = {
      title: card.title.trim().slice(0, 60),
      summary: (card.summary.trim() || card.content.slice(0, 80)).slice(0, 160),
      content: card.content,
      tags: card.tags.filter((tag) => tag.trim().length > 0).slice(0, 5),
      source: card.source,
      topic: classified.topic,
    };

    if (card.evidence && verified) {
      return {
        ...base,
        kind: card.kind,
        evidence: { sourceRole: card.evidence.sourceRole, text: evidenceText, verified: true },
        reviewStatus: "auto",
      };
    }

    return {
      ...base,
      kind: "inference",
      evidence: card.evidence
        ? { sourceRole: card.evidence.sourceRole, text: evidenceText, verified: false }
        : null,
      reviewStatus: "manual",
      reviewReason: card.evidence
        ? "证据与本轮原文不匹配（疑似伪造），转人工确认"
        : "无原文证据的模型断言，转人工确认",
    };
  }

  private buildTurnPrompt(task: TurnAnalysisInput, recentHistory?: string): string {
    const historyBlock = recentHistory?.trim()
      ? `\n历史上下文（仅供消歧，帮助理解本轮指代；严禁从中提取任何知识卡片，知识只能来自本轮对话）：
${recentHistory.trim().slice(0, TURN_HISTORY_LIMIT)}
`
      : "";

    return `你是记忆库的价值判断编辑。判断下面这轮对话是否包含值得长期保存的知识，若有则拆分为原子知识卡片。

判断规则：
1. 若本轮只是客套寒暄、乱码、纯情绪宣泄或无长期价值的内容，输出 {"type":"skip","reason":"一句中文原因"}，不要输出任何卡片。
2. 若包含长期知识（事实、偏好、决策、经验教训、配置、方法），输出 {"type":"knowledge","cards":[...]}，每个独立话题一张卡（最多 ${MAX_CARDS} 张）。
3. 全部用简体中文；专有名词、代码标识符、命令、配置项保留原文照写。
4. 每张卡字段：
   - title：20 字以内中文标题
   - summary：80 字以内中文一句话摘要
   - content：中文详细正文，保留数字、配置值、结论等细节，不编造原文没有的内容
   - tags：0-5 个中文标签
   - source：知识主要来源，"user"（用户自述）/"assistant"（模型解释）/"mixed"
   - kind：fact（有原文依据的事实）/ inference（推断）/ hypothesis（猜测）/ insight（洞见）/ synthesis（综合结论）
   - suggestedTopic：话题建议，供白名单分类参考，可为空字符串
   - evidence：支撑本卡的一句原文片段 {"sourceRole":"user"或"assistant","text":"逐字摘自对应发言"}；没有原文依据就填 null
5. 证据必须逐字摘自本轮原文（一字不差），禁止改写、拼接或编造证据；无法给出合规证据就填 null。
6. 模型解释的内容若在原文无依据，kind 填 inference——此类卡片会转人工确认，这是预期行为。
${historyBlock}
本轮用户发言：
${task.userText}

本轮助手发言：
${task.assistantText}

只回复 JSON，不要多余解释。`;
  }

  /**
   * 解析 LLM 输出：{"memories": [{"title","summary","content","tags"}]}
   * 逐卡校验（空标题/空正文丢弃）。三态：
   * - memories 数组存在但为空 → empty（模型明确判定无内容）
   * - JSON/结构无法解析或有效卡全被丢弃 → invalid（解析失败，由调用方重试）
   */
  private parseCards(
    text: string,
    sourceContent: string,
    similarCount = 0,
  ): { status: "ok"; cards: ExtractedCard[] } | { status: "empty" } | { status: "invalid" } {
    const json = this.extractJsonObject(text);
    if (!json) return { status: "invalid" };

    try {
      const parsed = JSON.parse(json) as { memories?: unknown };
      if (!Array.isArray(parsed.memories)) return { status: "invalid" };
      if (parsed.memories.length === 0) return { status: "empty" };

      const cards: ExtractedCard[] = [];
      for (const raw of parsed.memories.slice(0, MAX_CARDS)) {
        if (typeof raw !== "object" || raw === null) continue;
        const item = raw as Record<string, unknown>;
        const title = typeof item.title === "string" ? item.title.trim() : "";
        const summary = typeof item.summary === "string" ? item.summary.trim() : "";
        const content = typeof item.content === "string" ? item.content.trim() : "";
        if (!title || !content) continue;
        const tags = Array.isArray(item.tags)
          ? item.tags.filter((t): t is string => typeof t === "string" && t.trim().length > 0)
          : [];
        cards.push({
          title: title.slice(0, 60),
          summary: (summary || content.slice(0, 80)).slice(0, 160),
          content: this.limitExtractedContent(content, sourceContent),
          tags: tags.slice(0, 5),
          windowUse:
            typeof item.windowUse === "string" ? item.windowUse.trim().slice(0, 120) : undefined,
          entities: this.parseEntities(item.entities),
          causedBy: this.parseCausedBy(item.causedBy, MAX_CARDS),
          causedByExisting: this.parseCausedBy(item.causedByExisting, similarCount),
        });
      }

      return cards.length > 0 ? { status: "ok", cards } : { status: "invalid" };
    } catch {
      return { status: "invalid" };
    }
  }

  private extractJsonObject(text: string): string | null {
    const start = text.indexOf("{");
    if (start < 0) return null;
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let index = start; index < text.length; index++) {
      const char = text[index];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = quoted;
        continue;
      }
      if (char === '"') quoted = !quoted;
      if (quoted) continue;
      if (char === "{") depth += 1;
      if (char === "}") depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
    return null;
  }

  /** 实体列表容错解析：非字符串/空串丢弃，去重，最多 8 个，单个限 60 字符 */
  private parseEntities(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    for (const raw of value) {
      if (typeof raw !== "string") continue;
      const name = raw.trim();
      if (!name || name.length > 60) continue;
      seen.add(name);
      if (seen.size >= 8) break;
    }
    return [...seen];
  }

  /** 因果引用解析（batch 内序号与跨源条目编号共用）：字符串数字转整数、去重、越界与重复丢弃 */
  private parseCausedBy(value: unknown, max: number): number[] {
    if (!Array.isArray(value)) return [];
    const seen = new Set<number>();
    for (const raw of value) {
      const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
      if (!Number.isInteger(n) || n < 1 || n > max || seen.has(n)) continue;
      seen.add(n);
    }
    return [...seen];
  }

  private buildPrompt(candidate: MemoryRecord, similar: SimilarMemoryHint[]): string {
    const similarBlock = similar.length
      ? `\n知识库中已有的相似条目（编号 1-${similar.length}，用于 causedByExisting 引用；若某话题与它们完全等价，不要再输出该话题）：
${similar.map((s, i) => `${i + 1}. 《${s.title}》：${s.summary}`).join("\n")}
`
      : "";

    return `你是记忆库的编辑。下面是从用户本地文件/会话记录采集的原始内容（可能是英文、markdown 源码、会话日志或它们的混合）。请把它整理成若干张"原子记忆卡片"。

整理规则：
1. 按话题拆分：每张卡片只讲一个独立的话题（一个决策、一条约束、一个经验教训、一组配置事实）。原文里有几个独立话题就拆几张（最多 ${MAX_CARDS} 张）；整段只讲一件事就只输出 1 张。
2. 全部用简体中文重写，做到易读：口语转书面语；去掉会话日志格式、markdown 记号（##、**、反引号、- 列表符等）和过程性噪音（寒暄、工具调用记录、重复内容）。
3. 专有名词、代码标识符、文件路径、命令、配置项名称保留原文照写，但叙述文字必须是中文。
4. 每张卡片：
   - title：中文标题，20 字以内，概括该卡话题
   - summary：中文一句话摘要，80 字以内
   - content：中文详细日志，优先 1,500-20,000 字；必须保留笔记、坑点、问题与回答、数字、配置值、结论、段落结构和必要的原始上下文——这些细节会在后续对话中被检索并注入上下文，写长文（博客/报告）时全靠它，宁可长也不要概括丢细节。原文较短时按实际长度输出，不要编造内容。
   - tags：2-5 个中文标签
   - windowUse：这条记忆在什么场景下有用，120 字以内。格式如"当用户问 X / 需要做 Y / 排查 Z 问题时"。检索时用它匹配用户查询。
   - entities：这张卡片涉及的关键实体（工具名、库名、框架、技术、文件路径、命令、配置项等原文专有名词），保留原文写法，0-8 个；没有就给空数组。
   - causedBy：若本卡的结论/修复方法建立在本次整理的另一张卡之上（前因后果、前提依赖），填那张卡的序号（从 1 开始）；可多个；没有依赖就给空数组。
   - causedByExisting：若本卡的结论建立在上方"知识库中已有的相似条目"某条之上（本卡是该条的后续、修复或推翻），填那条的编号；只引用确实相关的条目，没有就给空数组。
5. 只整理原文确实包含的信息，不要编造或补充原文没有的内容。
${similarBlock}
来源：${candidate.source}
标题：${candidate.title}

原始内容：
${candidate.content.slice(0, PROMPT_CONTENT_LIMIT)}

只回复 JSON，不要多余解释：{"memories": [{"title": "...", "summary": "...", "content": "...", "tags": ["..."], "windowUse": "...", "entities": ["..."], "causedBy": [], "causedByExisting": []}]}`;
  }

  private limitExtractedContent(extracted: string, source: string): string {
    const cleaned = extracted.trim();
    if (source.length >= 1_500 && cleaned.length < 1_500) {
      return `${cleaned}\n\n[抽取内容不足，保留为待复核候选]`.slice(0, CARD_CONTENT_LIMIT);
    }
    return cleaned.slice(0, CARD_CONTENT_LIMIT);
  }
}
