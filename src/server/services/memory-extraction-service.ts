import { MemoryRecord } from "../../types/memory";
import { ModelAdapter } from "../../lib/ai/model-adapter";
import { SimilarMemoryHint } from "./quality-filter-service";
import { logger } from "../../lib/logger";

/** 抽取产出的一张原子记忆卡片（全部为中文人可读内容） */
export type ExtractedCard = {
  title: string;
  summary: string;
  content: string;
  tags: string[];
};

/** 单次抽取最多产出的卡片数：防止 LLM 失控拆出几十张导致成本爆炸 */
const MAX_CARDS = 8;
/** 送入 LLM 的原文上限（与采集侧 SESSION_CONTENT_MAX_CHARS 对齐后留余量） */
const PROMPT_CONTENT_LIMIT = 12_000;
/** 单卡正文的硬上限：保留长日志，但避免单条记忆无限膨胀。 */
const CARD_CONTENT_LIMIT = 10_000;
/** 非标准输出时的最大重试次数 */
const MAX_PARSE_ATTEMPTS = 2;

/**
 * 记忆抽取服务：把采集来的原始内容（英文 / markdown 源码 / 会话日志的混合体）
 * 按"一个话题一张卡片"拆分，并将每张卡片全文重写为简体中文。
 *
 * 这是"原文直存"与"人可读知识卡"的分界线：质量闸门只判断值不值得存，
 * 本服务负责决定"怎么存才易读"。失败时返回 null（fail-closed 转人工），绝不把半成品入库。
 */
export class MemoryExtractionService {
  async extract(
    candidate: MemoryRecord,
    similar: SimilarMemoryHint[] = [],
  ): Promise<ExtractedCard[] | null> {
    // 模型降级时无法改写 → 转人工（与质量闸门同一 fail-closed 策略）
    if (ModelAdapter.isDegradedMode) {
      return null;
    }

    const prompt = this.buildPrompt(candidate, similar);

    for (let attempt = 1; attempt <= MAX_PARSE_ATTEMPTS; attempt++) {
      try {
        const response = await ModelAdapter.generate(prompt, "flagship");
        const cards = this.parseCards(response.content, candidate.content);
        if (cards) return cards;
        logger.quality.warn("抽取输出非标准 JSON，重试", {
          attempt,
          output: response.content.slice(0, 200),
        });
      } catch (error) {
        logger.quality.warn("记忆抽取调用失败", { error: (error as Error).message });
        return null;
      }
    }

    return null;
  }

  /**
   * 解析 LLM 输出：{"memories": [{"title","summary","content","tags"}]}
   * 逐卡校验（空标题/空正文丢弃），返回空数组或结构异常时返回 null（由调用方转人工）。
   */
  private parseCards(text: string, sourceContent: string): ExtractedCard[] | null {
    const json = this.extractJsonObject(text);
    if (!json) return null;

    try {
      const parsed = JSON.parse(json) as { memories?: unknown };
      if (!Array.isArray(parsed.memories) || parsed.memories.length === 0) return null;

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
        });
      }

      return cards.length > 0 ? cards : null;
    } catch {
      return null;
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

  private buildPrompt(candidate: MemoryRecord, similar: SimilarMemoryHint[]): string {
    const similarBlock = similar.length
      ? `\n知识库中已有的相似条目（若某话题与它们完全等价，不要再输出该话题）：
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
   - content：中文详细日志，优先 1,500-10,000 字；必须保留笔记、坑点、问题与回答、数字、配置值、结论和必要的原始上下文。原文较短时按实际长度输出，不要编造内容。
   - tags：2-5 个中文标签
5. 只整理原文确实包含的信息，不要编造或补充原文没有的内容。
${similarBlock}
来源：${candidate.source}
标题：${candidate.title}

原始内容：
${candidate.content.slice(0, PROMPT_CONTENT_LIMIT)}

只回复 JSON，不要多余解释：{"memories": [{"title": "...", "summary": "...", "content": "...", "tags": ["..."]}]}`;
  }

  private limitExtractedContent(extracted: string, source: string): string {
    const cleaned = extracted.trim();
    if (source.length >= 1_500 && cleaned.length < 1_500) {
      return `${cleaned}\n\n[抽取内容不足，保留为待复核候选]`.slice(0, CARD_CONTENT_LIMIT);
    }
    return cleaned.slice(0, CARD_CONTENT_LIMIT);
  }
}
