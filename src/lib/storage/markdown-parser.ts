import { MemoryRecord } from "../../types/memory";
import { readFileSync } from "fs";
import { parseWikilinks } from "./markdown-formatter";

/**
 * LLMWiki 解析器：从 Markdown 文件反向解析出 MemoryRecord。
 *
 * 支持 YAML frontmatter 格式：
 * ---
 * id: "xxx"
 * title: "xxx"
 * topic: "ai-coding"
 * tags: ["react", "algorithm"]
 * related: ["id1", "id2"]
 * ---
 * # 标题
 * 正文...
 */
export function parseMemoryFromFile(filePath: string): MemoryRecord | null {
  try {
    const raw = readFileSync(filePath, "utf-8");
    return parseMemoryFromText(raw);
  } catch {
    return null;
  }
}

export function parseMemoryFromText(text: string): MemoryRecord | null {
  const frontmatter = extractFrontmatter(text);
  if (!frontmatter) return null;

  const body = extractBody(text);
  const now = new Date().toISOString();

  // 从文件 frontmatter 解析字段
  const id = frontmatter.id || "";
  const title = frontmatter.title || "";
  const titleZh = frontmatter.titleZh || undefined;
  const topic = frontmatter.topic || "uncategorized";
  const topicZh = frontmatter.topicZh || undefined;
  const tags = parseYamlArray(frontmatter.tags);
  const tagsZh = frontmatter.tagsZh ? parseYamlArray(frontmatter.tagsZh) : undefined;
  const related = parseYamlArray(frontmatter.related);
  const summary = frontmatter.summary || extractSummary(body);
  const summaryZh = frontmatter.summaryZh || undefined;

  // 从正文中提取 wikilinks
  const wikilinks = parseWikilinks(body);
  const allGraphLinks = [...new Set([...related, ...wikilinks])];

  return {
    id,
    version: parseInt(frontmatter.version) || 1,
    source: frontmatter.source || "",
    sourceType: (frontmatter.sourceType as MemoryRecord["sourceType"]) || "manual",
    kind: (frontmatter.kind as MemoryRecord["kind"]) || "fact",
    evidence: frontmatter.evidenceText
      ? {
          text: frontmatter.evidenceText,
          location: frontmatter.evidenceLocation || undefined,
        }
      : undefined,
    title,
    titleZh,
    content: body,
    summary,
    summaryZh,
    tags,
    tagsZh,
    topic,
    topicZh,
    createdAt: frontmatter.createdAt || now,
    updatedAt: frontmatter.updatedAt || now,
    accessedAt: frontmatter.accessedAt || now,
    accessCount: parseInt(frontmatter.accessCount) || 0,
    heatScore: parseFloat(frontmatter.heatScore) || 0,
    graphLinks: allGraphLinks,
  };
}

/** 提取 frontmatter 键值对 */
function extractFrontmatter(text: string): Record<string, string> | null {
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;

  const result: Record<string, string> = {};
  const lines = match[1].split("\n");

  let currentKey = "";
  let currentValue = "";
  let inArray = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (inArray) {
      currentValue += " " + trimmed;
      if (trimmed.endsWith("]")) {
        inArray = false;
        result[currentKey] = currentValue.trim();
        currentKey = "";
        currentValue = "";
      }
      continue;
    }

    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) continue;

    const key = trimmed.substring(0, colonIdx).trim();
    let value = trimmed.substring(colonIdx + 1).trim();

    // 去掉引号
    value = value.replace(/^["']|["']$/g, "");

    if (value.startsWith("[") && !value.endsWith("]")) {
      currentKey = key;
      currentValue = value;
      inArray = true;
    } else {
      result[key] = value;
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}

/** 提取正文（去掉 frontmatter 和 wikilink 段落后） */
function extractBody(text: string): string {
  const parts = text.split(/^---$/m);
  // parts[0] 可能是空，parts[1] 是 frontmatter，parts[2]+ 是正文
  if (parts.length >= 3) {
    return parts.slice(2).join("---").trim();
  }
  // 没有 frontmatter 的情况
  return text.trim();
}

/** 解析 YAML 数组值，如 ["a", "b"] 或 a, b */
function parseYamlArray(value: string | undefined): string[] {
  if (!value || value === "[]") return [];
  // 尝试 ["a", "b"] 格式
  const jsonMatch = value.match(/\[([^\]]*)\]/);
  if (jsonMatch) {
    const inner = jsonMatch[1];
    if (!inner) return [];
    return inner
      .split(",")
      .map((s) => s.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
  }
  // 逗号分隔
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 提取摘要（正文前 200 字） */
function extractSummary(body: string): string {
  const cleaned = body
    .replace(/#{1,6}\s/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return cleaned.length <= 200 ? cleaned : cleaned.substring(0, 200) + "...";
}

/**
 * 从文件批量构建 wikilink 索引
 * 用于替代 SQLite graph_edges 表
 */
export type WikilinkIndex = Map<string, string[]>;

export function buildWikilinkIndex(filePaths: string[]): WikilinkIndex {
  const index: WikilinkIndex = new Map();

  for (const filePath of filePaths) {
    const record = parseMemoryFromFile(filePath);
    if (!record) continue;

    index.set(record.id, record.graphLinks);
  }

  return index;
}
