import { MemoryRecord } from "../../types/memory";

export const formatMemoryContent = (content: string): string => {
  let formatted = content.trim();

  formatted = formatted.replace(/\r\n/g, "\n");
  formatted = formatted.replace(/\n{3,}/g, "\n\n");
  formatted = formatted.replace(/[ \t]+/g, " ");

  return formatted;
};

export const formatMemoryToMarkdown = (memory: MemoryRecord): string => {
  return `---
id: ${memory.id}
version: ${memory.version}
source: ${memory.source}
sourceType: ${memory.sourceType}
title: ${memory.title}
tags: ${memory.tags.join(", ")}
createdAt: ${memory.createdAt}
updatedAt: ${memory.updatedAt}
accessedAt: ${memory.accessedAt}
accessCount: ${memory.accessCount}
heatScore: ${memory.heatScore.toFixed(4)}
---

# ${memory.title}

${memory.summary}

---

${memory.content}

---

## 相关记忆
${memory.graphLinks.map((id) => `- [${id}]`).join("\n")}`;
};

export const formatSummary = (content: string, maxLength: number = 200): string => {
  const cleaned = content.replace(/\n/g, " ").trim();

  if (cleaned.length <= maxLength) {
    return cleaned;
  }

  const truncated = cleaned.substring(0, maxLength - 3);
  const lastSentenceEnd = Math.max(
    truncated.lastIndexOf("."),
    truncated.lastIndexOf("。"),
    truncated.lastIndexOf("!"),
    truncated.lastIndexOf("！"),
    truncated.lastIndexOf("?"),
    truncated.lastIndexOf("？"),
  );

  if (lastSentenceEnd > maxLength * 0.5) {
    return truncated.substring(0, lastSentenceEnd + 1);
  }

  return truncated + "...";
};
