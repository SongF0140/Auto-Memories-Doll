import { MemoryRecord } from "../../types/memory";
import { getDatabase } from "../../lib/storage/database";
import { generateId } from "../../lib/utils/id";
import { getCurrentTime } from "../../lib/utils/date";
import Database from "better-sqlite3";

/**
 * 结构化 Lint（I-1）：知识库的 CI/CD 管道。
 *
 * LLM Wiki 的 Link Intelligence 分两层——结构检查便宜（不调 LLM），语义检查才调。
 * 本服务只做结构层：**零 LLM 调用**，因此可以在每次夜跑无成本地全量扫描。
 * 语义层（矛盾检测）由 contradiction-detector 承担。
 */
export type LintIssue =
  /** graphLinks 指向了不存在的记忆（记忆被删除后成为悬挂引用） */
  | { type: "dead-link"; from: string; to: string }
  /** 没有任何出边、入边，且同 topic 下也没有邻居的孤立卡 */
  | { type: "orphan"; memoryId: string }
  /** front matter 关键字段缺失，无法做类型过滤/状态检测/图谱导出 */
  | { type: "incomplete-card"; memoryId: string; missing: string[] }
  /** 同一来源原文被重复入库 */
  | { type: "duplicate-hash"; memoryIds: string[] };

export type LintIssueType = LintIssue["type"];

export type StoredLintIssue = LintIssue & {
  issueId: string;
  detectedAt: string;
  status: "open" | "resolved" | "ignored";
};

/** 残缺卡判定字段：缺任一即无法被检索与导航正确消费 */
const REQUIRED_FIELDS: Array<keyof MemoryRecord> = ["title", "summary", "tags", "topic"];

export class StructureLintService {
  private db: Database.Database;

  constructor(db: Database.Database = getDatabase()) {
    this.db = db;
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS lint_issues (
        issueId TEXT PRIMARY KEY,
        issueType TEXT NOT NULL,
        issueKey TEXT NOT NULL,
        memoryId TEXT,
        payload TEXT NOT NULL,
        detectedAt TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        resolvedAt TEXT
      )
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_lint_issues_status ON lint_issues(status, issueType)
    `);
  }

  /** 全量规则扫描，不调用任何 LLM。复杂度 O(N + E)，千级记忆 < 1s。 */
  run(all: MemoryRecord[]): LintIssue[] {
    const issues: LintIssue[] = [];
    if (all.length === 0) return issues;

    const ids = new Set(all.map((m) => m.id));
    const incoming = new Map<string, number>();
    const topicCount = new Map<string, number>();

    for (const memory of all) {
      topicCount.set(memory.topic, (topicCount.get(memory.topic) ?? 0) + 1);
      for (const link of memory.graphLinks) {
        if (!link || link === memory.id) continue;
        incoming.set(link, (incoming.get(link) ?? 0) + 1);
      }
    }

    const hashGroups = new Map<string, string[]>();

    for (const memory of all) {
      // 1) 死链：指向不存在的记忆
      for (const link of memory.graphLinks) {
        if (!link || link === memory.id) continue;
        if (!ids.has(link)) {
          issues.push({ type: "dead-link", from: memory.id, to: link });
        }
      }

      // 2) 孤儿页：无出边、无入边、同 topic 下也没有邻居
      const validOutgoing = memory.graphLinks.filter((l) => l && l !== memory.id && ids.has(l));
      const hasIncoming = (incoming.get(memory.id) ?? 0) > 0;
      const topicPeers = topicCount.get(memory.topic) ?? 0;
      if (validOutgoing.length === 0 && !hasIncoming && topicPeers <= 1) {
        issues.push({ type: "orphan", memoryId: memory.id });
      }

      // 3) 残缺卡：必需字段缺失
      const missing = REQUIRED_FIELDS.filter((field) => {
        const value = memory[field];
        if (Array.isArray(value)) return value.length === 0;
        return typeof value !== "string" || value.trim() === "";
      }).map((field) => String(field));
      if (missing.length > 0) {
        issues.push({ type: "incomplete-card", memoryId: memory.id, missing });
      }

      // 4) 重复来源哈希
      const hash = memory.evidence?.sourceHash?.trim();
      if (hash) {
        const group = hashGroups.get(hash) ?? [];
        group.push(memory.id);
        hashGroups.set(hash, group);
      }
    }

    for (const group of hashGroups.values()) {
      if (group.length > 1) {
        issues.push({ type: "duplicate-hash", memoryIds: [...group].sort() });
      }
    }

    return issues;
  }

  /**
   * 落库并去重：同一 issueKey 已存在 open 记录时跳过，
   * 避免每次夜跑无限堆积重复条目。返回新增条数。
   */
  persist(issues: LintIssue[]): number {
    const insert = this.db.prepare(`
      INSERT INTO lint_issues (issueId, issueType, issueKey, memoryId, payload, detectedAt, status)
      VALUES (?, ?, ?, ?, ?, ?, 'open')
    `);
    const existingOpen = this.db.prepare(
      `SELECT 1 FROM lint_issues WHERE issueType = ? AND issueKey = ? AND status = 'open' LIMIT 1`,
    );

    const transaction = this.db.transaction((list: LintIssue[]) => {
      let added = 0;
      for (const issue of list) {
        const key = issueKeyOf(issue);
        if (existingOpen.get(issue.type, key)) continue;
        insert.run(
          generateId(),
          issue.type,
          key,
          "memoryId" in issue ? issue.memoryId : "from" in issue ? issue.from : null,
          JSON.stringify(issue),
          getCurrentTime(),
        );
        added += 1;
      }
      return added;
    });

    return transaction(issues);
  }

  listOpen(issueType?: LintIssueType): StoredLintIssue[] {
    const rows = issueType
      ? (this.db
          .prepare(
            `SELECT * FROM lint_issues WHERE status = 'open' AND issueType = ? ORDER BY detectedAt DESC`,
          )
          .all(issueType) as any[])
      : (this.db
          .prepare(`SELECT * FROM lint_issues WHERE status = 'open' ORDER BY detectedAt DESC`)
          .all() as any[]);

    return rows.map((row) => ({
      ...(JSON.parse(row.payload) as LintIssue),
      issueId: row.issueId,
      detectedAt: row.detectedAt,
      status: row.status,
    }));
  }

  /** 扫描 + 落库的一步到位入口，供夜跑直接调用 */
  scanAndPersist(all: MemoryRecord[]): { issues: LintIssue[]; added: number } {
    const issues = this.run(all);
    return { issues, added: this.persist(issues) };
  }

  /** 关闭连接由 closeDatabase() 统一管理（共享连接） */
  close(): void {
    // shared connection - closed by closeDatabase()
  }
}

/** 同一问题的稳定标识，用于去重 */
export function issueKeyOf(issue: LintIssue): string {
  switch (issue.type) {
    case "dead-link":
      return `${issue.from}->${issue.to}`;
    case "orphan":
    case "incomplete-card":
      return issue.memoryId;
    case "duplicate-hash":
      return issue.memoryIds.join("|");
  }
}
