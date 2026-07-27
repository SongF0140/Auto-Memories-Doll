import { MemoryRecord } from "../../types/memory";
import { buildMemoryRecord } from "../../lib/memory/builder";
import { formatSummary } from "../../server/pipelines/formatter";
import { extractTags } from "../../server/pipelines/json-pipeline";
import { classifyTopic, classifyTopicWithRules, TopicRule } from "../../config/topics.config";
import { generateZhFields } from "../../lib/memory/translator";

export type { TopicRule };

export interface MemoryExtractionOptions {
  maxSummaryLength?: number;
  maxTagCount?: number;
}

export class MemoryExtractor {
  /** 调用时可传入自定义话题规则，与默认规则合并生效 */
  private customTopicRules: TopicRule[];

  constructor(customTopicRules: TopicRule[] = []) {
    this.customTopicRules = customTopicRules;
  }

  extractFromText(
    source: string,
    sourceType: "chat" | "ingest" | "manual" | "mcp" | "skill" | "listen",
    text: string,
    options: MemoryExtractionOptions = {}
  ): MemoryRecord {
    const title = this.extractTitle(text);
    const summary = formatSummary(text, options.maxSummaryLength || 200);
    const tags = extractTags(text).slice(0, options.maxTagCount || 5);
    const topic = this.extractTopic(text);
    const zhFields = generateZhFields(title, summary, tags, topic);

    return buildMemoryRecord(source, sourceType, title, text, summary, tags, topic, undefined, zhFields);
  }

  extractFromStructuredData(
    source: string,
    sourceType: "chat" | "ingest" | "manual" | "mcp" | "skill" | "listen",
    data: { title: string; content: string; tags?: string[]; summary?: string; topic?: string }
  ): MemoryRecord {
    const title = data.title || this.extractTitle(data.content);
    const summary = data.summary || formatSummary(data.content);
    const tags = data.tags || extractTags(data.content).slice(0, 5);
    const topic = data.topic || this.extractTopic(data.content);
    const zhFields = generateZhFields(title, summary, tags, topic);

    return buildMemoryRecord(source, sourceType, title, data.content, summary, tags, topic, undefined, zhFields);
  }

  private extractTitle(text: string): string {
    const lines = text.split("\n").filter(l => l.trim());
    
    for (const line of lines) {
      if (line.startsWith("# ")) {
        return line.substring(2).trim();
      }
    }
    
    for (const line of lines) {
      if (line.length > 5 && line.length < 80) {
        return line.trim();
      }
    }
    
    return text.substring(0, 50).replace(/\n/g, " ").trim() + "...";
  }

  /** 从内容中提取话题分类：默认规则 + topics.json + 构造时传入的自定义规则，三层合并 */
  extractTopic(text: string): string {
    return classifyTopicWithRules(text, this.customTopicRules);
  }

  /** 动态追加一条临时话题规则（不影响构造时传入的规则列表） */
  extractTopicWithExtra(text: string, extraRules: TopicRule[]): string {
    return classifyTopicWithRules(text, [...this.customTopicRules, ...extraRules]);
  }
}