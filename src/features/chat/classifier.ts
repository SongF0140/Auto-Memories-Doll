import { ModelAdapter } from "../../lib/ai/model-adapter";
import { cosineSimilarity } from "../../lib/vector/similarity";
import {
  INTENT_CLASSIFY_KEYWORD_THRESHOLD,
  INTENT_DEFAULT_CONFIDENCE,
  INTENT_EMBEDDING_THRESHOLD,
  INTENT_KEYWORD_BASE_CONFIDENCE,
  INTENT_KEYWORD_MATCH_BONUS,
  INTENT_KEYWORD_POSITION_BONUS,
  INTENT_MAX_CONFIDENCE,
} from "../../config/constants";

export type IntentType =
  | "chat"
  | "memory_query"
  | "memory_create"
  | "memory_update"
  | "memory_delete"
  | "prompt_edit"
  | "system_command";

/** 多意图候选 */
export interface IntentCandidate {
  type: IntentType;
  confidence: number;
  matchedKeywords: string[];
}

export interface IntentResult {
  type: IntentType;
  confidence: number;
  entities: Record<string, string>;
  matchedKeywords: string[];
  /** 多意图备选（embedding 分析时可能有多个意图命中） */
  alternatives?: IntentCandidate[];
}

/** budget LLM 提取的记忆结构化实体 */
export interface ExtractedMemoryEntity {
  title: string;
  content: string;
  tags: string[];
  topic: string;
}

/** 意图的语义描述，用于 embedding 相似度计算 */
const INTENT_DESCRIPTIONS: Record<Exclude<IntentType, "chat" | "system_command">, string> = {
  memory_create: "创建、保存、记录新的记忆或知识，例如记住某个信息、存储内容、创建备忘录、留存笔记",
  memory_update: "修改、更新、编辑、纠正已有的记忆，例如改一下、变更内容、修正信息、调整记录、指出记错的地方",
  memory_delete: "删除、移除、清除记忆或知识，例如删掉、去掉、清理不需要的内容、擦除记录",
  memory_query: "查询、搜索、查找、回忆已有的记忆，例如找一下之前的内容、看看保存的知识、搜索信息",
  prompt_edit: "修改提示词、prompt、系统模板、AI 指令，例如改提示词、调整系统设定",
};

/**
 * 用户意图分类器 —— 三层级联增强版
 *
 * Layer 1 - 关键词匹配（同步，<1ms）
   *   基于关键词命中率的置信度评分，≥配置阈值直接返回。
 *
 * Layer 2 - Embedding 语义回退（异步，~100ms）
   *   关键词置信度 <配置阈值时，用 embedding 向量相似度匹配意图描述。
   *   支持多意图检测：返回相似度 >=配置阈值的所有候选，降序排列。
 *
 * Layer 3 - Budget LLM 实体提取（异步，~500ms）
 *   memory_create / memory_update 意图时，调用廉价模型提取
 *   title、tags、topic、content 结构化字段。
 */
export class ChatClassifier {
  // ── Layer 1: 关键词 ──

  private static readonly INTENT_KEYWORDS: Record<Exclude<IntentType, "chat" | "system_command">, string[]> = {
    memory_create: ["记住", "保存", "记录", "存下", "记一下"],
    memory_update: ["更新", "修改", "编辑", "改一下", "变更", "记错", "纠正", "更正"],
    memory_delete: ["删除", "移除", "清除", "删掉", "去掉"],
    memory_query: ["查询", "查找", "搜索", "回忆", "找一下", "看看"],
    prompt_edit: ["提示词", "prompt", "模板", "template"],
  };

  /** 纯关键词分类（同步，向后兼容） */
  classify(text: string): IntentResult {
    const lowerText = text.toLowerCase().trim();

    // system_command 由 / 开头判定
    if (lowerText.startsWith("/")) {
      return {
        type: "system_command",
        confidence: 0.95,
        entities: { command: lowerText.substring(1) },
        matchedKeywords: [],
      };
    }

    let bestIntent: IntentType = "chat";
    let bestScore = INTENT_DEFAULT_CONFIDENCE;
    let bestMatched: string[] = [];

    for (const [intent, keywords] of Object.entries(ChatClassifier.INTENT_KEYWORDS) as Array<
      [Exclude<IntentType, "chat" | "system_command">, string[]]
    >) {
      const matched = keywords.filter((kw) => lowerText.includes(kw));
      if (matched.length === 0) continue;

      const positionBonus = lowerText.indexOf(matched[0]) < 10 ? INTENT_KEYWORD_POSITION_BONUS : 0;
      const score = Math.min(
        INTENT_MAX_CONFIDENCE,
        INTENT_KEYWORD_BASE_CONFIDENCE + INTENT_KEYWORD_MATCH_BONUS * matched.length + positionBonus,
      );

      if (score > bestScore) {
        bestScore = score;
        bestIntent = intent;
        bestMatched = matched;
      }
    }

    return {
      type: bestIntent,
      confidence: bestScore,
      entities: {},
      matchedKeywords: bestMatched,
    };
  }

  // ── Layer 2: Embedding 语义回退 ──

  /** 意图描述 → embedding 向量缓存，首次调用时懒加载 */
  private intentEmbeddingCache: Map<string, number[]> | null = null;

  /**
   * 异步增强分类：关键词优先，低置信度时用 embedding 语义回退。
   * handler.ts 的主要入口。
   */
  async classifyAsync(text: string): Promise<IntentResult> {
    // Layer 1: 关键词快速路径
    const keywordResult = this.classify(text);
    if (keywordResult.confidence >= INTENT_CLASSIFY_KEYWORD_THRESHOLD || keywordResult.type === "system_command") {
      return keywordResult;
    }

    // Layer 2: Embedding 语义回退
    try {
      return await this.classifyByEmbedding(text, keywordResult);
    } catch {
      // embedding 失败 → 退化到关键词结果
      return keywordResult;
    }
  }

  private async classifyByEmbedding(text: string, keywordFallback: IntentResult): Promise<IntentResult> {
    const textEmbedding = await ModelAdapter.generateEmbedding(text);
    if (textEmbedding.embedding.length === 0) return keywordFallback;

    await this.ensureIntentEmbeddings();

    const candidates: IntentCandidate[] = [];
    const intentTypes = Object.keys(INTENT_DESCRIPTIONS) as Array<Exclude<IntentType, "chat" | "system_command">>;

    for (const intent of intentTypes) {
      const intentEmb = this.intentEmbeddingCache!.get(intent);
      if (!intentEmb) continue;

      const similarity = cosineSimilarity(textEmbedding.embedding, intentEmb);
      if (similarity >= INTENT_EMBEDDING_THRESHOLD) {
        candidates.push({ type: intent, confidence: Math.round(similarity * 100) / 100, matchedKeywords: [] });
      }
    }

    candidates.sort((a, b) => b.confidence - a.confidence);

    if (candidates.length === 0) return keywordFallback;

    return {
      type: candidates[0].type,
      confidence: candidates[0].confidence,
      entities: {},
      matchedKeywords: [],
      alternatives: candidates.slice(1, 3),
    };
  }

  /** 懒加载意图描述 embedding 向量 */
  private async ensureIntentEmbeddings(): Promise<void> {
    if (this.intentEmbeddingCache) return;

    this.intentEmbeddingCache = new Map();
    const intents = Object.keys(INTENT_DESCRIPTIONS) as Array<Exclude<IntentType, "chat" | "system_command">>;

    // 并发获取所有意图描述的 embedding
    const results = await Promise.all(
      intents.map(async (intent) => {
        const desc = INTENT_DESCRIPTIONS[intent];
        const resp = await ModelAdapter.generateEmbedding(desc);
        return { intent, embedding: resp.embedding };
      }),
    );

    const validResults = results.filter((r) => r.embedding.length > 0);
    for (const { intent, embedding } of validResults) {
      this.intentEmbeddingCache.set(intent, embedding);
    }
  }

  // ── Layer 3: Budget LLM 实体提取 ──

  /** budget 模型提取记忆结构化字段 */
  async extractMemoryEntity(userText: string): Promise<ExtractedMemoryEntity | null> {
    const prompt = `从用户消息中提取记忆信息，返回严格的 JSON 格式（不要包含 markdown 标记）：
{
  "title": "记忆标题（20字以内）",
  "content": "记忆正文内容",
  "tags": ["标签1", "标签2"],
  "topic": "所属主题分类（如 ai、前端、后端、工具 等）"
}

如果消息中不包含可提取的记忆内容，返回：
{ "title": "", "content": "", "tags": [], "topic": "" }

用户消息：${userText}`;

    try {
      const response = await ModelAdapter.generate(prompt, "budget");
      const jsonStr = response.content.trim();

      // 清理可能的 markdown 代码块包裹
      const cleanJson = jsonStr.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");

      const parsed = JSON.parse(cleanJson) as Partial<ExtractedMemoryEntity>;

      if (!parsed.title && !parsed.content) return null;

      return {
        title: parsed.title || "",
        content: parsed.content || "",
        tags: Array.isArray(parsed.tags) ? parsed.tags.filter((t) => typeof t === "string") : [],
        topic: parsed.topic || "",
      };
    } catch {
      return null;
    }
  }
}
