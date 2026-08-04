export type MemoryCategory = "knowledge" | "experience" | "task" | "idea" | "note" | "other";

export interface MemoryClassification {
  category: MemoryCategory;
  confidence: number;
  subcategories: string[];
  matchedKeywords: string[];
}

/**
 * 记忆分类器 —— 基于关键词命中率的真实置信度评分。
 *
 * 置信度公式：
 *   base = 0.4（other 兜底）
 *   + 0.13 * matchedCount     (每命中一个关键词 +0.13)
 *   + 0.05 * positionBonus     (命中在开头 +0.05)
 *   上限 0.95
 *
 * 与 AGENTS.md 4.4 "置信度评分" 和《架构检查文档.md》4.4 对齐：
 * 区分"高可信事实"（多关键词命中）与"待确认推测"（单关键词）。
 */
export class MemoryClassifier {
  private static readonly CATEGORY_KEYWORDS: Record<Exclude<MemoryCategory, "other">, string[]> = {
    knowledge: ["学习", "知识", "了解", "研究", "掌握"],
    experience: ["经历", "经验", "做过", "遇到", "实践"],
    task: ["任务", "计划", "待办", "目标", "schedule"],
    idea: ["想法", "创意", "构思", "灵感", "idea"],
    note: ["笔记", "记录", "备忘", "摘要", "note"],
  };

  classify(content: string): MemoryClassification {
    const lowerContent = content.toLowerCase();

    let bestCategory: MemoryCategory = "other";
    let bestScore = 0.4; // other 兜底置信度
    let bestMatched: string[] = [];

    for (const [category, keywords] of Object.entries(MemoryClassifier.CATEGORY_KEYWORDS) as Array<
      [Exclude<MemoryCategory, "other">, string[]]
    >) {
      const matched = keywords.filter((kw) => lowerContent.includes(kw.toLowerCase()));
      if (matched.length === 0) continue;

      const positionBonus = lowerContent.indexOf(matched[0].toLowerCase()) < 20 ? 0.05 : 0;
      const score = Math.min(0.95, 0.5 + 0.13 * matched.length + positionBonus);

      if (score > bestScore) {
        bestScore = score;
        bestCategory = category;
        bestMatched = matched;
      }
    }

    return {
      category: bestCategory,
      confidence: bestScore,
      subcategories: this.extractSubcategories(content),
      matchedKeywords: bestMatched,
    };
  }

  private extractSubcategories(content: string): string[] {
    const subcategories: string[] = [];

    const patterns: Record<string, string[]> = {
      技术: ["编程", "代码", "开发", "软件", "系统"],
      工作: ["项目", "会议", "汇报", "团队", "客户"],
      生活: ["旅行", "美食", "运动", "阅读", "电影"],
      学习: ["课程", "书籍", "论文", "讲座", "培训"],
    };

    for (const [category, keywords] of Object.entries(patterns)) {
      if (keywords.some((kw) => content.toLowerCase().includes(kw))) {
        subcategories.push(category);
      }
    }

    return subcategories;
  }
}
