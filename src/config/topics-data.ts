/**
 * 话题分类数据（客户端安全，无 Node.js 依赖）
 *
 * 包含默认规则、标签映射和纯数据导出，
 * 供前端组件和后端模块共用。
 */

export type TopicRule = {
  pattern: string;
  topic: string;
};

export type CompiledRule = {
  regex: RegExp;
  topic: string;
};

/** 默认话题规则 */
export const defaultRules: TopicRule[] = [
  {
    pattern:
      "代码|编程|react|next\\.?js|typescript|前端|后端|api|bug|debug|算法|code\\b|programming|frontend|backend|database|sqlite|docker|deploy|git|node\\.?js|python|rust|golang",
    topic: "ai-coding",
  },
  { pattern: "日记|今天|心情|生活|日常|备忘|diary|daily|journal|mood|log", topic: "daily-notes" },
  {
    pattern:
      "项目|需求|架构|设计|规划|roadmap|project|architecture|planning|design system|milestone",
    topic: "project-planning",
  },
  {
    pattern: "学习|教程|笔记|知识|总结|learn|tutorial|study|knowledge|guide|how.?to|course",
    topic: "learning",
  },
  {
    pattern: "会议|讨论|决策|review|meeting|discussion|decision|retro|standup|sync",
    topic: "meetings",
  },
  {
    pattern: "阅读|书籍|文章|论文|paper|reading|book|article|research|arxiv|pdf",
    topic: "reading",
  },
  { pattern: "想法|灵感|创意|brainstorm|idea|thought|creativity|draft|sketch", topic: "ideas" },
];

/** 话题键 → 中文显示标签 */
export const defaultTopicLabels: Record<string, string> = {
  "ai-coding": "AI 编程",
  "daily-notes": "日常记录",
  "project-planning": "项目规划",
  learning: "学习笔记",
  meetings: "会议记录",
  reading: "阅读摘录",
  ideas: "灵感想法",
  uncategorized: "未分类",
};

export function compileRules(rules: TopicRule[]): CompiledRule[] {
  return rules.map((r) => ({
    regex: new RegExp(r.pattern, "i"),
    topic: r.topic,
  }));
}

/** 合并默认规则 + 用户自定义规则（用户规则优先） + 额外规则（最优先） */
export function mergeRules(userRules: TopicRule[], extraRules: TopicRule[] = []): CompiledRule[] {
  if (userRules.length === 0 && extraRules.length === 0) {
    return compileRules(defaultRules);
  }

  const coveredTopics = new Set<string>();

  // 第1层：额外规则（最优先匹配）
  const merged: TopicRule[] = [];
  for (const r of extraRules) {
    merged.push(r);
    coveredTopics.add(r.topic);
  }

  // 第2层：用户 topics.json 规则（不在额外规则中的话题）
  for (const r of userRules) {
    if (!coveredTopics.has(r.topic)) {
      merged.push(r);
      coveredTopics.add(r.topic);
    }
  }

  // 第3层：默认规则（不在前两层中的话题）
  for (const def of defaultRules) {
    if (!coveredTopics.has(def.topic)) {
      merged.push(def);
      coveredTopics.add(def.topic);
    }
  }

  return compileRules(merged);
}

/** 导出默认规则供前端展示 */
export function getDefaultTopicRules(): TopicRule[] {
  return [...defaultRules];
}

/** 获取话题的中文显示标签（客户端安全） */
export function getTopicLabelClient(topic: string): string {
  return defaultTopicLabels[topic] || topic;
}
