/** 简易中文化工具：基于关键词映射和规则生成中文版本字段 */
import { getTopicLabelClient } from "../../config/topics.config";

/** 常用英文 → 中文标题映射表 */
const EN_ZH_TITLE_PATTERNS: [RegExp, string][] = [
  [/\bHow to\b/i, "如何"],
  [/\bImplement(?:ing)?\b/i, "实现"],
  [/\bFix(?:ing)?\b/i, "修复"],
  [/\bSetup\b/i, "搭建"],
  [/\bDebug(?:ging)?\b/i, "调试"],
  [/\bConfigure\b/i, "配置"],
  [/\bOptimize\b/i, "优化"],
  [/\bRefactor(?:ing)?\b/i, "重构"],
  [/\bDesign(?:ing)?\b/i, "设计"],
  [/\bCreate\b/i, "创建"],
  [/\bBuild(?:ing)?\b/i, "构建"],
  [/\bDeploy(?:ing)?\b/i, "部署"],
  [/\bwith\b/i, "使用"],
  [/\bin\b/i, "在"],
  [/\busing\b/i, "使用"],
  [/\bfor\b/i, "用于"],
  [/\bReact\b/i, "React"],
  [/\bNext\.js\b/i, "Next.js"],
  [/\bTypeScript\b/i, "TypeScript"],
  [/\bSQLite\b/i, "SQLite"],
  [/\bAPI\b/i, "API"],
  [/\bAI\b/i, "AI"],
  [/\bLLM\b/i, "LLM"],
  [/\bvector\b/gi, "向量"],
  [/\bdatabase\b/gi, "数据库"],
  [/\bembedding\b/gi, "嵌入"],
  [/\bcomponent\b/gi, "组件"],
  [/\balgorithm\b/gi, "算法"],
  [/\ba\b|\ban\b|the\b/gi, ""],
];

/** 话题中文标签 */
const TOPIC_LABELS: Record<string, string> = {
  "ai-coding": "AI 编程",
  "daily-notes": "日常记录",
  "project-planning": "项目规划",
  "learning": "学习笔记",
  "meetings": "会议记录",
  "reading": "阅读摘录",
  "ideas": "灵感想法",
  "uncategorized": "未分类",
};

export function translateTitle(title: string): string {
  if (/[\u4e00-\u9fff]/.test(title)) {
    return title;
  }

  let result = title;
  for (const [pattern, replacement] of EN_ZH_TITLE_PATTERNS) {
    result = result.replace(pattern, replacement);
  }

  result = result.replace(/\s{2,}/g, " ").trim();

  if (result === title.trim() || result.length < 2) {
    return title;
  }

  return result;
}

export function translateTopicZh(topic: string): string {
  return TOPIC_LABELS[topic] || getTopicLabelClient(topic);
}

/** 为一组英文标签生成对应的中文标签 */
export function translateTags(tags: string[]): string[] {
  const tagMap: Record<string, string> = {
    "react": "React",
    "nextjs": "Next.js",
    "next.js": "Next.js",
    "typescript": "TypeScript",
    "sqlite": "SQLite",
    "database": "数据库",
    "vector": "向量",
    "algorithm": "算法",
    "frontend": "前端",
    "backend": "后端",
    "api": "API",
    "ai": "AI",
    "llm": "LLM",
    "embedding": "嵌入",
    "bug": "缺陷",
    "fix": "修复",
    "deploy": "部署",
    "docker": "Docker",
    "testing": "测试",
    "javascript": "JavaScript",
    "python": "Python",
    "rust": "Rust",
    "config": "配置",
    "component": "组件",
    "design": "设计",
    "ui": "UI",
    "ux": "UX",
    "performance": "性能",
  };

  return tags.map(t => tagMap[t.toLowerCase()] || t);
}

/** 生成完整的中文版本字段 */
export function generateZhFields(
  title: string,
  summary: string,
  tags: string[],
  topic: string
): { titleZh?: string; summaryZh?: string; tagsZh?: string[]; topicZh?: string } {
  const titleZh = translateTitle(title);
  const topicZh = translateTopicZh(topic);
  const tagsZh = translateTags(tags);

  // summary 如果超过 80% 是英文，尝试浅翻译
  const chineseCharCount = (summary.match(/[\u4e00-\u9fff]/g) || []).length;
  const summaryZh = chineseCharCount > summary.length * 0.3 ? undefined : translateTitle(summary);

  return {
    titleZh,
    topicZh,
    tagsZh: tagsZh.length > 0 ? tagsZh : undefined,
    summaryZh,
  };
}
