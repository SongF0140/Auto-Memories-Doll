export type MemoryCategory = "knowledge" | "experience" | "task" | "idea" | "note" | "other";

export interface MemoryClassification {
  category: MemoryCategory;
  confidence: number;
  subcategories: string[];
}

export class MemoryClassifier {
  classify(content: string): MemoryClassification {
    const lowerContent = content.toLowerCase();

    if (
      lowerContent.includes("学习") ||
      lowerContent.includes("知识") ||
      lowerContent.includes("了解") ||
      lowerContent.includes("研究")
    ) {
      return {
        category: "knowledge",
        confidence: 0.85,
        subcategories: this.extractSubcategories(content),
      };
    }

    if (
      lowerContent.includes("经历") ||
      lowerContent.includes("经验") ||
      lowerContent.includes("做过") ||
      lowerContent.includes("遇到")
    ) {
      return {
        category: "experience",
        confidence: 0.8,
        subcategories: this.extractSubcategories(content),
      };
    }

    if (
      lowerContent.includes("任务") ||
      lowerContent.includes("计划") ||
      lowerContent.includes("待办") ||
      lowerContent.includes("目标")
    ) {
      return {
        category: "task",
        confidence: 0.85,
        subcategories: this.extractSubcategories(content),
      };
    }

    if (
      lowerContent.includes("想法") ||
      lowerContent.includes("创意") ||
      lowerContent.includes("构思") ||
      lowerContent.includes("灵感")
    ) {
      return {
        category: "idea",
        confidence: 0.8,
        subcategories: this.extractSubcategories(content),
      };
    }

    if (
      lowerContent.includes("笔记") ||
      lowerContent.includes("记录") ||
      lowerContent.includes("备忘")
    ) {
      return {
        category: "note",
        confidence: 0.85,
        subcategories: this.extractSubcategories(content),
      };
    }

    return {
      category: "other",
      confidence: 0.5,
      subcategories: [],
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
