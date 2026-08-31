import { ConversationData, ConversationMessage } from "../../types/memory";
import { MemoryExtractor } from "../memory/extractor";
import { generateZhFields } from "../../lib/memory/translator";
import { buildKnowledgeLog } from "./knowledge-log";

export type ProcessingResult = {
  memoryIds: string[];
  topicDir: string;
  knowledgeCards: KnowledgeCard[];
};

export type KnowledgeCard = {
  title: string;
  titleZh?: string;
  summary: string;
  content: string;
  tags: string[];
  tagsZh?: string[];
  topic: string;
  topicZh?: string;
};

export class ConversationProcessor {
  private extractor = new MemoryExtractor();

  formatConversation(data: ConversationData): { title: string; content: string; topic: string } {
    const messages = data.messages;
    const topic = data.topic || this.extractConversationTopic(data);
    const title = data.title || this.extractConversationTitle(messages);
    const content = this.messagesToContent(messages, data.source, data.metadata);

    return { title, content, topic };
  }

  extractConversationTopic(data: ConversationData): string {
    const fullText = data.messages.map((m) => m.content).join("\n");
    return this.extractor.extractTopic(fullText);
  }

  private extractConversationTitle(messages: ConversationMessage[]): string {
    const firstUserMsg = messages.find((m) => m.role === "user");
    if (firstUserMsg) {
      return firstUserMsg.content.substring(0, 60).replace(/\n/g, " ");
    }
    return `对话 - ${new Date().toLocaleDateString("zh-CN")}`;
  }

  /** 消息列表转为对话正文（供 LLMWiki 使用） */
  private messagesToContent(
    messages: ConversationMessage[],
    source: string,
    metadata?: ConversationData["metadata"],
  ): string {
    const lines: string[] = [];

    if (metadata) {
      lines.push(
        `> 来源: ${metadata.platform || source}${metadata.model ? ` | 模型: ${metadata.model}` : ""}${metadata.url ? ` | [原始链接](${metadata.url})` : ""}`,
      );
      lines.push("");
    }
    lines.push(`> 导入时间: ${new Date().toISOString()}`);
    lines.push("");
    lines.push("---");
    lines.push("");

    for (const msg of messages) {
      const roleLabel =
        msg.role === "user" ? "### 用户" : msg.role === "assistant" ? "### AI" : "### 系统";
      lines.push(roleLabel);
      lines.push("");
      lines.push(msg.content);
      lines.push("");
    }

    return lines.join("\n");
  }

  generateKnowledgeCard(data: ConversationData): KnowledgeCard {
    const { title, topic } = this.formatConversation(data);
    const log = buildKnowledgeLog(data.messages, {
      source: data.source,
      metadata: data.metadata,
    });
    const tags = data.tags || [];
    const zhFields = generateZhFields(title, log.summary, tags, topic);

    return {
      title,
      titleZh: zhFields.titleZh,
      summary: log.summary,
      content: log.content,
      tags,
      tagsZh: zhFields.tagsZh,
      topic,
      topicZh: zhFields.topicZh,
    };
  }
}
