import { MemoryRecord } from "../../types/memory";

/**
 * LLMWiki 格式器：将 MemoryRecord 序列化为自包含的 Markdown 文件。
 *
 * 每条记忆是一个独立文件，包含：
 * - YAML frontmatter（元数据：id、tags、topic、时间戳等）
 * - 正文（人类 + LLM 可直读）
 * - [[wikilink]] 关系引用（替代 SQLite graph_edges 表）
 *
 * 这样 LLM 可以直接读取整个知识库目录作为 context，无需任何转换。
 */

const FRONTMATTER_DELIMITER = "---";

export function formatFrontmatter(record: MemoryRecord): string {
  const lines = [
    FRONTMATTER_DELIMITER,
    `id: "${record.id}"`,
    `title: "${escapeYaml(record.title)}"`,
    record.titleZh ? `titleZh: "${escapeYaml(record.titleZh)}"` : "",
    `topic: "${record.topic}"`,
    record.topicZh ? `topicZh: "${record.topicZh}"` : "",
    `source: "${record.source}"`,
    `sourceType: "${record.sourceType}"`,
    `createdAt: "${record.createdAt}"`,
    `updatedAt: "${record.updatedAt}"`,
    `version: ${record.version}`,
    record.heatScore > 0 ? `heatScore: ${record.heatScore.toFixed(2)}` : `heatScore: 0`,
  ].filter(l => l !== "");

  // tags
  if (record.tags.length > 0) {
    lines.push(`tags: [${record.tags.map(t => `"${escapeYaml(t)}"`).join(", ")}]`);
  } else {
    lines.push(`tags: []`);
  }

  // tagsZh
  if (record.tagsZh && record.tagsZh.length > 0) {
    lines.push(`tagsZh: [${record.tagsZh.map(t => `"${escapeYaml(t)}"`).join(", ")}]`);
  }

  // summary / summaryZh
  if (record.summary) {
    lines.push(`summary: "${escapeYaml(record.summary)}"`);
  }
  if (record.summaryZh) {
    lines.push(`summaryZh: "${escapeYaml(record.summaryZh)}"`);
  }

  // related 记忆（wikilink 关系）
  const relatedIds = record.graphLinks.filter(id => id && id !== record.id);
  if (relatedIds.length > 0) {
    lines.push(`related: [${relatedIds.map(id => `"${id}"`).join(", ")}]`);
  }

  lines.push(FRONTMATTER_DELIMITER);
  lines.push("");
  return lines.join("\n");
}

/** 将完整记忆格式化为 LLMWiki 文件 */
export function formatMemoryAsMarkdown(record: MemoryRecord): string {
  const frontmatter = formatFrontmatter(record);

  // 正文：标题 + 内容
  const body = [
    `# ${record.title}`,
    "",
    record.summary ? `> ${record.summary}` : "",
    record.summary ? "" : "",
    record.content,
    "",
    "---",
    "",
    "## 关联记忆",
    "",
  ];

  // wikilinks
  const relatedIds = record.graphLinks.filter(id => id && id !== record.id);
  if (relatedIds.length > 0) {
    relatedIds.forEach(id => {
      body.push(`- [[${id}]]`);
    });
  } else {
    body.push("_暂无关联记忆_");
  }

  body.push("");

  return frontmatter + body.join("\n");
}

/** 从对话消息生成 LLMWiki Markdown（用于 /api/listen 新记忆） */
export function formatConversationAsMarkdown(content: string, title: string, tags: string[], topic: string, relatedMemories: string[] = []): string {
  const lines = [
    FRONTMATTER_DELIMITER,
    `title: "${escapeYaml(title)}"`,
    `topic: "${topic}"`,
    tags.length > 0 ? `tags: [${tags.map(t => `"${escapeYaml(t)}"`).join(", ")}]` : `tags: []`,
    `sourceType: "listen"`,
    `createdAt: "${new Date().toISOString()}"`,
    `updatedAt: "${new Date().toISOString()}"`,
    relatedMemories.length > 0 ? `related: [${relatedMemories.map(id => `"${id}"`).join(", ")}]` : "",
    FRONTMATTER_DELIMITER,
    "",
    `# ${title}`,
    "",
    content,
    "",
  ].filter(l => l !== "");

  return lines.join("\n");
}

/** 从 memoryId 生成 wikilink */
export function toWikilink(memoryId: string): string {
  return `[[${memoryId}]]`;
}

/** 解析正文中的 [[wikilink]] 引用，返回被引用的 memoryId 列表 */
export function parseWikilinks(content: string): string[] {
  const pattern = /\[\[([^\]]+)\]\]/g;
  const ids: string[] = [];
  let match;
  while ((match = pattern.exec(content)) !== null) {
    ids.push(match[1].trim());
  }
  return [...new Set(ids)];
}

/** YAML 安全转义 */
function escapeYaml(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}
