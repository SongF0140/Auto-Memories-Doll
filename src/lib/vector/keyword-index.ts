import type Database from "better-sqlite3";
import { MemoryRecord } from "../../types/memory";
import { getDatabase } from "../storage/database";
import { VectorSearchResult } from "./backend";

type KeywordSearchRow = Pick<
  MemoryRecord,
  "id" | "title" | "content" | "summary" | "tags" | "topic" | "updatedAt"
> &
  Partial<Pick<MemoryRecord, "titleZh" | "summaryZh" | "tagsZh" | "topicZh">>;

const FIELD_WEIGHTS = {
  title: 6,
  tags: 5,
  topic: 4,
  summary: 3,
  content: 1,
} as const;

const MAX_TERMS = 12;

function normalize(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase();
}

function queryTerms(query: string): string[] {
  const normalized = normalize(query).trim();
  if (!normalized) return [];

  const splitTerms = normalized
    .split(/[^\p{L}\p{N}]+/u)
    .map((term) => term.trim())
    .filter(Boolean);

  return [...new Set([normalized, ...splitTerms])].slice(0, MAX_TERMS);
}

/**
 * 对 SQLite memories 行执行确定性的字段加权关键词排序。
 *
 * 这是 Embedding 不可用时的保底召回，不承担语义相似度职责。返回值继续使用
 * similarity 字段以兼容现有 Ranker；该分数仅表示当前关键词结果内的相对相关度。
 */
export function rankByKeywords(
  query: string,
  rows: KeywordSearchRow[],
  limit: number,
): VectorSearchResult[] {
  const terms = queryTerms(query);
  if (terms.length === 0 || limit <= 0) return [];

  const normalizedQuery = normalize(query).trim();
  const maxScorePerTerm = Object.values(FIELD_WEIGHTS).reduce((sum, weight) => sum + weight, 0);

  return rows
    .map((row) => {
      const fields = {
        title: normalize([row.title, row.titleZh].filter(Boolean).join(" ")),
        tags: normalize([...(row.tags || []), ...(row.tagsZh || [])].join(" ")),
        topic: normalize([row.topic, row.topicZh].filter(Boolean).join(" ")),
        summary: normalize([row.summary, row.summaryZh].filter(Boolean).join(" ")),
        content: normalize(row.content),
      };
      const tagValues = [...(row.tags || []), ...(row.tagsZh || [])].map((tag) => normalize(tag));

      let score = 0;
      for (const term of terms) {
        for (const [field, weight] of Object.entries(FIELD_WEIGHTS)) {
          if (fields[field as keyof typeof fields].includes(term)) score += weight;
        }
      }

      // 完整标题或标签命中优先于正文中的偶然片段。
      const titleExactMatch = fields.title === normalizedQuery;
      const tagExactMatch = tagValues.includes(normalizedQuery);
      if (titleExactMatch) score += FIELD_WEIGHTS.title;
      if (tagExactMatch) score += FIELD_WEIGHTS.tags;

      const denominator =
        terms.length * maxScorePerTerm +
        (titleExactMatch ? FIELD_WEIGHTS.title : 0) +
        (tagExactMatch ? FIELD_WEIGHTS.tags : 0);
      const similarity = Math.min(1, 0.3 + (score / denominator) * 0.7);

      return {
        memoryId: row.id,
        similarity,
        score,
        updatedAt: row.updatedAt,
      };
    })
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score || b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit)
    .map(({ memoryId, similarity }) => ({ memoryId, similarity }));
}

/** SQLite 主表上的只读关键词检索。无需额外索引即可在离线状态立即工作。 */
export class KeywordIndex {
  private db: Database.Database;

  constructor() {
    this.db = getDatabase();
  }

  search(query: string, limit: number): VectorSearchResult[] {
    const terms = queryTerms(query);
    if (terms.length === 0 || limit <= 0) return [];

    const memoriesTable = this.db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'memories'")
      .get();
    if (!memoriesTable) return [];

    const fields = [
      "title",
      "titleZh",
      "content",
      "summary",
      "summaryZh",
      "tags",
      "tagsZh",
      "topic",
      "topicZh",
    ];
    const whereClause = terms
      .map(() => `(${fields.map((field) => `${field} LIKE ? ESCAPE '\\'`).join(" OR ")})`)
      .join(" OR ");
    const params = terms.flatMap((term) => fields.map(() => `%${escapeLike(term)}%`));
    const candidateLimit = Math.max(limit * 8, 50);

    const rows = this.db
      .prepare(
        `
        SELECT id, title, titleZh, content, summary, summaryZh,
               tags, tagsZh, topic, topicZh, updatedAt
        FROM memories
        WHERE ${whereClause}
        ORDER BY updatedAt DESC
        LIMIT ?
      `,
      )
      .all(...params, candidateLimit) as Array<
      Omit<KeywordSearchRow, "tags" | "tagsZh"> & { tags: string; tagsZh?: string }
    >;

    return rankByKeywords(
      query,
      rows.map((row) => ({
        ...row,
        tags: parseTags(row.tags),
        tagsZh: parseTags(row.tagsZh),
      })),
      limit,
    );
  }

  close(): void {
    // shared connection — no-op
  }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function parseTags(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    return [];
  }
}
