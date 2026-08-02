import { MemoryRecord } from "../../types/memory";
import { formatMemoryAsMarkdown } from "./markdown-formatter";
import { getNotePath, getAgentPath } from "./path-resolver";
import { writeFile } from "./file-manager";

/**
 * 将单条记忆写入 LLMWiki Markdown 文件。
 * 路径规则：memory-root/notes/{topic}/{memoryId}.md
 */
export async function writeMemoryMarkdown(record: MemoryRecord): Promise<void> {
  const path = getNotePath(record.topic, record.id);
  const content = formatMemoryAsMarkdown(record);
  await writeFile(path, content);
}

/**
 * 更新某话题的 Agent.md（短时记忆要点）。
 * 内容包含该话题下所有记忆的标题、摘要与最近更新时间。
 */
export async function updateAgentMarkdown(
  topic: string,
  memories: MemoryRecord[],
): Promise<void> {
  const topicMemories = memories
    .filter((m) => m.topic === topic)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const lines: string[] = [
    `# ${topic} 话题要点`,
    "",
    `> 本文件由系统自动生成，汇总了 **${topic}** 话题下的短时记忆要点。`,
    "",
    "## 记忆列表",
    "",
  ];

  if (topicMemories.length === 0) {
    lines.push("_暂无记忆_", "");
  } else {
    topicMemories.forEach((m) => {
      lines.push(`### [[${m.id}]] ${m.title}`);
      lines.push("");
      lines.push(m.summary || "_无摘要_");
      lines.push("");
      lines.push(`- 标签: ${m.tags.length > 0 ? m.tags.join(", ") : "_无_"}`);
      lines.push(`- 更新: ${m.updatedAt}`);
      lines.push(`- 热度: ${m.heatScore.toFixed(2)}`);
      lines.push("");
    });
  }

  await writeFile(getAgentPath(topic), lines.join("\n"));
}
