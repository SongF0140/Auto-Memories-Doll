import { ExtractedMemoryEntity, IntentResult } from "./classifier";

export type SystemBlocks = {
  systemPrefix: string;
  intentBlock: string;
  memoryBlock: string;
};

export function buildIntentBlock(
  intent?: IntentResult | null,
  extractedEntity?: ExtractedMemoryEntity | null,
): string {
  if (!intent || intent.type === "chat") return "";

  const parts: string[] = [];
  parts.push(`## 意图识别\n${intent.type} (置信度 ${(intent.confidence * 100).toFixed(0)}%)`);
  if (intent.matchedKeywords.length > 0) {
    parts.push(`匹配关键词: ${intent.matchedKeywords.join(", ")}`);
  }
  if (intent.alternatives && intent.alternatives.length > 0) {
    const altStr = intent.alternatives
      .map((candidate) => `${candidate.type} (${(candidate.confidence * 100).toFixed(0)}%)`)
      .join(", ");
    parts.push(`其他候选: ${altStr}`);
  }
  if (extractedEntity) {
    parts.push("\n已提取实体:");
    if (extractedEntity.title) parts.push(`- 标题: ${extractedEntity.title}`);
    if (extractedEntity.tags.length > 0) parts.push(`- 标签: ${extractedEntity.tags.join(", ")}`);
    if (extractedEntity.topic) parts.push(`- 主题: ${extractedEntity.topic}`);
    if (extractedEntity.content) {
      parts.push(`- 内容摘要: ${extractedEntity.content.substring(0, 200)}`);
    }
  }

  return parts.join("\n");
}

export function assembleSystemMessage(blocks: SystemBlocks): string {
  return `${blocks.systemPrefix}
${blocks.intentBlock}

${blocks.memoryBlock}

你现在要以记忆伴侣的身份，根据以上信息为用户提供最贴心的回答。`;
}
