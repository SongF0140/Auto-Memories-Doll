/**
 * 检索评测（Retrieval Evaluation Harness）
 *
 * 运行方式：`npm run eval`（也会随 `npm test` 一起跑，作为回归基线）。
 *
 * 评测两条链路：
 * - keyword：embedding 不可用（无 Key / 降级）时的 SQLite 关键词保底召回；
 * - vector：确定性本地 embedding（字符 bigram 哈希）走完整
 *   VectorIndex(js-exact) 余弦检索链路，不依赖外部 API，CI 可复现。
 *
 * 指标：Recall@1 / Recall@5 / Recall@10 / MRR，
 * 报告写入 evals/reports/retrieval-eval-report.{json,md}。
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import Database from "better-sqlite3";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const EVAL_DIMENSIONS = 256;
const SEED_TIME = "2026-08-23T00:00:00.000Z";

const { dbRef, evalMock, bigramEmbedding } = vi.hoisted(() => {
  /**
   * 确定性伪语义向量：字符 bigram 哈希到固定维度后归一化。
   * 共享字符越多余弦相似度越高，足以在评测集上拉开相关/不相关差距，
   * 同时保证无外部 API 时评测结果可复现。
   */
  function bigramEmbedding(text: string, dimensions = EVAL_DIMENSIONS): number[] {
    const vector = new Array<number>(dimensions).fill(0);
    const normalized = text.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
    for (let i = 0; i < normalized.length - 1; i++) {
      const bigram = normalized.slice(i, i + 2);
      let hash = 2166136261;
      for (let j = 0; j < bigram.length; j++) {
        hash ^= bigram.charCodeAt(j);
        hash = Math.imul(hash, 16777619);
      }
      const bucket = Math.abs(hash) % dimensions;
      vector[bucket] += 1;
    }
    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    return norm === 0 ? vector : vector.map((v) => v / norm);
  }

  return {
    dbRef: { current: null as Database.Database | null },
    evalMock: { useVector: false },
    bigramEmbedding,
  };
});

// 共享 SQLite 连接 → 内存数据库（模式与 memory-service.test.ts 一致）
vi.mock("../lib/storage/database", () => ({
  getDatabase: () => dbRef.current,
  closeDatabase: () => {
    if (dbRef.current) {
      dbRef.current.close();
      dbRef.current = null;
    }
  },
}));

// 向量生成 → 由 evalMock 控制：关闭时返回空向量触发关键词降级，开启时用确定性向量
vi.mock("../lib/vector/generator", () => ({
  generateEmbedding: async (text: string) =>
    evalMock.useVector ? bigramEmbedding(text) : [],
  isEmbeddingEmpty: (embedding: number[]) => embedding.length === 0,
  buildVectorRecord: async (memoryId: string, text: string) => ({
    memoryId,
    embedding: bigramEmbedding(text),
    model: "eval-bigram",
    dimensions: EVAL_DIMENSIONS,
    updatedAt: SEED_TIME,
  }),
}));

import { MemoryService } from "../server/services/memory-service";
import { VectorIndex } from "../lib/vector/index";
import { VectorRetriever } from "../lib/vector/retriever";
import { EVAL_MEMORIES, EVAL_QUERIES } from "./fixtures";
import { computeMetrics, groupMetrics, RankedHit } from "./metrics";

function seedMemories(db: Database.Database): void {
  const stmt = db.prepare(`
    INSERT INTO memories (
      id, version, source, sourceType, title, titleZh, content, summary, summaryZh,
      tags, tagsZh, topic, topicZh, createdAt, updatedAt, accessedAt,
      accessCount, heatScore, vectorId, graphLinks
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const m of EVAL_MEMORIES) {
    stmt.run(
      m.id, 1, "eval", "manual", m.title, null, m.content, m.summary, null,
      JSON.stringify(m.tags), null, m.topic, null,
      SEED_TIME, SEED_TIME, SEED_TIME, 0, 0, null, JSON.stringify([]),
    );
  }
}

function seedVectors(): void {
  const index = new VectorIndex();
  try {
    for (const m of EVAL_MEMORIES) {
      const text = [m.title, m.summary, m.content, m.tags.join(" "), m.topic].join(" ");
      index.create({
        memoryId: m.id,
        embedding: bigramEmbedding(text),
        model: "eval-bigram",
        dimensions: EVAL_DIMENSIONS,
        updatedAt: SEED_TIME,
      });
    }
  } finally {
    index.close();
  }
}

async function runRetrieval(useVector: boolean): Promise<RankedHit[]> {
  evalMock.useVector = useVector;
  const retriever = new VectorRetriever();
  try {
    const hits: RankedHit[] = [];
    for (const q of EVAL_QUERIES) {
      // minSimilarity=0：评测关注排序质量，阈值过滤留给真实模型场景
      const response = await retriever.searchDetailed(q.query, 10, 0);
      hits.push({
        query: q.query,
        ranked: response.results.map((r) => r.memoryId),
        expected: q.expected,
        group: q.kind,
      });
    }
    return hits;
  } finally {
    retriever.close();
  }
}

describe("检索评测（Recall@k / MRR）", () => {
  let keywordHits: RankedHit[] = [];
  let vectorHits: RankedHit[] = [];

  beforeAll(() => {
    process.env.VECTOR_BACKEND = "js";
    dbRef.current = new Database(":memory:");
    // 触发 memories / vector_records 等表的 CREATE TABLE
    new MemoryService().close();
    new VectorIndex().close();
    seedMemories(dbRef.current);
    seedVectors();
  });

  afterAll(() => {
    if (dbRef.current) {
      dbRef.current.close();
      dbRef.current = null;
    }
  });

  it("keyword 模式：关键词保底召回达到基线", async () => {
    keywordHits = await runRetrieval(false);
    const metrics = computeMetrics(keywordHits);

    // 阈值含义：评测集上的回归下限，指标明显劣化时测试失败。
    // 关键词保底召回无法覆盖口语化改写（byKind.colloquial 恒为 0 属预期），
    // 故总体下限按 title + keyword 类目的表现设定。
    expect(metrics.recallAt5).toBeGreaterThanOrEqual(0.7);
    expect(metrics.mrr).toBeGreaterThanOrEqual(0.7);
  });

  it("vector 模式：确定性向量召回达到基线，且口语化改写优于关键词", async () => {
    vectorHits = await runRetrieval(true);
    const metrics = computeMetrics(vectorHits);

    expect(metrics.recallAt5).toBeGreaterThanOrEqual(0.8);
    expect(metrics.mrr).toBeGreaterThanOrEqual(0.7);

    // 语义检索的核心价值：口语化改写在关键词召回为 0 时仍能被召回
    const vectorColloquial = groupMetrics(vectorHits).colloquial;
    const keywordColloquial = groupMetrics(keywordHits).colloquial;
    expect(vectorColloquial.recallAt5).toBeGreaterThan(keywordColloquial.recallAt5);
  });

  it("评测报告写入 evals/reports", () => {
    const report = {
      generatedAt: new Date().toISOString(),
      fixture: {
        memories: EVAL_MEMORIES.length,
        queries: EVAL_QUERIES.length,
      },
      modes: {
        keyword: {
          overall: computeMetrics(keywordHits),
          byKind: groupMetrics(keywordHits),
        },
        vector: {
          overall: computeMetrics(vectorHits),
          byKind: groupMetrics(vectorHits),
        },
      },
    };

    const reportDir = join(process.cwd(), "evals", "reports");
    mkdirSync(reportDir, { recursive: true });
    writeFileSync(
      join(reportDir, "retrieval-eval-report.json"),
      JSON.stringify(report, null, 2),
      "utf-8",
    );
    writeFileSync(join(reportDir, "retrieval-eval-report.md"), renderMarkdown(report), "utf-8");
  });
});

function renderMarkdown(report: {
  generatedAt: string;
  fixture: { memories: number; queries: number };
  modes: Record<
    string,
    {
      overall: { total: number; recallAt1: number; recallAt5: number; recallAt10: number; mrr: number };
      byKind: Record<string, { total: number; recallAt1: number; recallAt5: number; recallAt10: number; mrr: number }>;
    }
  >;
}): string {
  const lines: string[] = [
    "# 检索评测报告",
    "",
    `- 生成时间: ${report.generatedAt}`,
    `- 评测集: ${report.fixture.memories} 条记忆 / ${report.fixture.queries} 条查询`,
    "",
    "## 总体指标",
    "",
    "| 模式 | Recall@1 | Recall@5 | Recall@10 | MRR |",
    "| --- | --- | --- | --- | --- |",
  ];
  for (const [mode, data] of Object.entries(report.modes)) {
    const m = data.overall;
    lines.push(`| ${mode} | ${m.recallAt1} | ${m.recallAt5} | ${m.recallAt10} | ${m.mrr} |`);
  }
  lines.push("", "## 按查询类型分组", "");
  for (const [mode, data] of Object.entries(report.modes)) {
    lines.push(`### ${mode}`, "");
    lines.push("| 类型 | 查询数 | Recall@1 | Recall@5 | MRR |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const [kind, m] of Object.entries(data.byKind)) {
      lines.push(`| ${kind} | ${m.total} | ${m.recallAt1} | ${m.recallAt5} | ${m.mrr} |`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
