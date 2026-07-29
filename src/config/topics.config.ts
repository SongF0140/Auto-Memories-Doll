/**
 * 话题分类配置（服务端，含 fs 文件读取）
 *
 * 纯数据和客户端安全函数已拆分到 topics-data.ts，
 * 本文件仅包含需要读取 memory-root/topics.json 的服务端逻辑。
 */
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { getMemoryRoot } from "../lib/storage/path-resolver";
import {
  defaultRules,
  compileRules,
  type CompiledRule,
  mergeRules,
  type TopicRule,
} from "./topics-data";

export type { TopicRule, CompiledRule };

export { defaultRules, compileRules, mergeRules, getTopicLabelClient, getDefaultTopicRules, defaultTopicLabels } from "./topics-data";

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

/** 获取所有可用话题名 */
export function getAvailableTopics(): string[] {
  const rules = getTopicRules();
  const topics = rules.map((r) => r.topic);
  return [...new Set([...topics, "uncategorized"])];
}
