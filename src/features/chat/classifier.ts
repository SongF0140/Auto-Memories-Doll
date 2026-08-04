export type IntentType =
  | "chat"
  | "memory_query"
  | "memory_create"
  | "memory_update"
  | "memory_delete"
  | "prompt_edit"
  | "system_command";

export interface IntentResult {
  type: IntentType;
  confidence: number;
  entities: Record<string, string>;
  matchedKeywords: string[];
}

/**
 * 用户意图分类器 —— 基于关键词命中率的真实置信度评分。
 *
 * 置信度公式：
 *   base = 0.5
 *   + 0.12 * matchedCount     (每命中一个关键词 +0.12)
 *   + 0.05 * positionBonus     (命中在文本开头 +0.05)
 *   上限 0.95
 *
 * 若无任何意图命中，回退到 chat 意图，置信度 0.5（最低阈值）。
 *
 * 与 AGENTS.md 4.4 "分类驱动路由" 和《架构检查文档.md》4.4 "置信度评分" 对齐。
 */
export class ChatClassifier {
  private static readonly INTENT_KEYWORDS: Record<Exclude<IntentType, "chat" | "system_command">, string[]> = {
    memory_create: ["记住", "保存", "记录", "存下", "记一下"],
    memory_update: ["更新", "修改", "编辑", "改一下", "变更"],
    memory_delete: ["删除", "移除", "清除", "删掉", "去掉"],
    memory_query: ["查询", "查找", "搜索", "回忆", "找一下", "看看"],
    prompt_edit: ["提示词", "prompt", "模板", "template"],
  };

  classify(text: string): IntentResult {
    const lowerText = text.toLowerCase().trim();

    // system_command 由语法特征（/ 开头）判定，置信度直接给高值
    if (lowerText.startsWith("/")) {
      return {
        type: "system_command",
        confidence: 0.95,
        entities: { command: lowerText.substring(1) },
        matchedKeywords: [],
      };
    }

    // 扫描所有意图的关键词，统计命中数与位置
    let bestIntent: IntentType = "chat";
    let bestScore = 0.3; // chat 兜底置信度
    let bestMatched: string[] = [];

    for (const [intent, keywords] of Object.entries(ChatClassifier.INTENT_KEYWORDS) as Array<
      [Exclude<IntentType, "chat" | "system_command">, string[]]
    >) {
      const matched = keywords.filter((kw) => lowerText.includes(kw));
      if (matched.length === 0) continue;

      const positionBonus = lowerText.indexOf(matched[0]) < 10 ? 0.05 : 0;
      const score = Math.min(0.95, 0.5 + 0.12 * matched.length + positionBonus);

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
}
