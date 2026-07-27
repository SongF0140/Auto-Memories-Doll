import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { getMemoryRoot } from "../lib/storage/path-resolver";

/**
 * 话题分类配置
 *
 * 每条规则包含：
 * - pattern: 正则表达式，匹配内容中的关键词（不区分大小写）
 * - topic: 匹配后归入的话题目录名
 *
 * 自定义方式：
 *   在 memory-root/topics.json 中添加覆盖项，格式与下面相同。
 *   文件不存在时使用默认配置。
 */

export type TopicRule = {
  pattern: string;
  topic: string;
};

type CompiledRule = {
  regex: RegExp;
  topic: string;
};

/** 默认话题规则 */
const defaultRules: TopicRule[] = [
  { pattern: "代码|编程|react|next\\.?js|typescript|前端|后端|api|bug|debug|算法|code\\b|programming|frontend|backend|database|sqlite|docker|deploy|git|node\\.?js|python|rust|golang", topic: "ai-coding" },
  { pattern: "日记|今天|心情|生活|日常|备忘|diary|daily|journal|mood|log", topic: "daily-notes" },
  { pattern: "项目|需求|架构|设计|规划|roadmap|project|architecture|planning|design system|milestone", topic: "project-planning" },
  { pattern: "学习|教程|笔记|知识|总结|learn|tutorial|study|knowledge|guide|how.?to|course", topic: "learning" },
  { pattern: "会议|讨论|决策|review|meeting|discussion|decision|retro|standup|sync", topic: "meetings" },
  { pattern: "阅读|书籍|文章|论文|paper|reading|book|article|research|arxiv|pdf", topic: "reading" },
  { pattern: "想法|灵感|创意|brainstorm|idea|thought|creativity|draft|sketch", topic: "ideas" },
];

/** 话题键 → 中文显示标签 */
const defaultTopicLabels: Record<string, string> = {
  "ai-coding": "AI 编程",
  "daily-notes": "日常记录",
  "project-planning": "项目规划",
  "learning": "学习笔记",
  "meetings": "会议记录",
  "reading": "阅读摘录",
  "ideas": "灵感想法",
  "uncategorized": "未分类",
};

/** 编译正则并缓存 */
let compiledCache: CompiledRule[] | null = null;
let cacheHash = "";

function compileRules(rules: TopicRule[]): CompiledRule[] {
  return rules.map(r => ({
    regex: new RegExp(r.pattern, "i"),
    topic: r.topic,
  }));
}

/** 加载用户自定义话题配置（memory-root/topics.json） */
function loadUserTopics(): TopicRule[] {
  try {
    const userPath = join(getMemoryRoot(), "topics.json");
    if (!existsSync(userPath)) return [];

    const raw = readFileSync(userPath, "utf-8");
    const parsed = JSON.parse(raw) as TopicRule[];

    if (Array.isArray(parsed) && parsed.length > 0) {
      for (const rule of parsed) {
        if (typeof rule.pattern !== "string" || typeof rule.topic !== "string") {
          console.warn("[TopicsConfig] 无效规则跳过:", JSON.stringify(rule));
          return [];
        }
      }
      return parsed;
    }
  } catch (e) {
    console.warn("[TopicsConfig] 加载 topics.json 失败:", (e as Error).message);
  }
  return [];
}

/** 合并默认规则 + 用户自定义规则（用户规则优先） + 额外规则（最优先） */
function mergeRules(userRules: TopicRule[], extraRules: TopicRule[] = []): CompiledRule[] {
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

/** 获取当前生效的话题规则（默认 + 用户自定义，合并生效） */
export function getTopicRules(): CompiledRule[] {
  const userRules = loadUserTopics();
  const merged = mergeRules(userRules);
  return merged;
}

/**
 * 根据内容匹配话题分类（使用默认 + 用户配置）
 * @returns 话题目录名，无匹配返回 "uncategorized"
 */
export function classifyTopic(content: string): string {
  return classifyTopicWithRules(content, []);
}

/**
 * 根据内容匹配话题分类（默认 + 用户配置 + 调用时传入的额外规则）
 * 额外规则优先级最高，其次是用户 topics.json，最后是默认规则
 * @returns 话题目录名，无匹配返回 "uncategorized"
 */
export function classifyTopicWithRules(content: string, extraRules: TopicRule[]): string {
  const userRules = loadUserTopics();
  const merged = mergeRules(userRules, extraRules);

  for (const rule of merged) {
    rule.regex.lastIndex = 0;
    if (rule.regex.test(content)) {
      return rule.topic;
    }
  }

  return "uncategorized";
}

/** 导出默认规则供前端展示 */
export function getDefaultTopicRules(): TopicRule[] {
  return [...defaultRules];
}

/** 获取所有可用话题名 */
export function getAvailableTopics(): string[] {
  const rules = getTopicRules();
  const topics = rules.map(r => r.topic);
  return [...new Set([...topics, "uncategorized"])];
}

/**
 * 获取话题的中文显示标签（仅客户端可用，不含 fs 读取）
 */
export function getTopicLabelClient(topic: string): string {
  return defaultTopicLabels[topic] || topic;
}
