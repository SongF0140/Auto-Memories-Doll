/**
 * Locomo 风格基准评测（I-12）
 *
 * 运行方式：`npm run eval:locomo`（也会随 `npm test` 一起跑，作为回归基线）。
 *
 * 三组对照（同一数据集、同一把尺子）：
 * - bare     裸模型（无记忆检索）：任何检索都不做，作为下界参照
 * - baseline 现行 RAG（改造前）：embedding 键在 content，纯向量单路召回
 * - improved 改进后管线：embedding 键 = summary + windowUse（I-11），
 *            走 I-8 自适应路由 + RRF 融合
 *
 * 指标：Recall@1 / Recall@5 / Recall@10 / MRR，按单跳/多跳/时序分组。
 * 报告写入 evals/reports/locomo-eval-report.{json,md}，沉淀每次跑分作为改进验收依据。
 *
 * 确定性：使用字符 bigram 哈希向量（不依赖外部 API），CI 可复现。
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import Database from "better-sqlite3";
import { mkdirSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";

const EVAL_DIMENSIONS = 256;
const SEED = "2026-04-30T00:00:00.000Z";

const { dbRef, bigramEmbedding } = vi.hoisted(() => {
  function bigramEmbedding(text: string, dimensions = 256): number[] {
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
  return { dbRef: { current: null as Database.Database | null }, bigramEmbedding };
});

vi.mock("../lib/storage/database", () => ({
  getDatabase: () => dbRef.current,
  closeDatabase: () => {
    if (dbRef.current) {
      dbRef.current.close();
      dbRef.current = null;
    }
  },
}));

// query embedding 用确定性向量；buildVectorRecord 交给各对照臂自行决定键
vi.mock("../lib/vector/generator", () => ({
  generateEmbedding: async (text: string) => bigramEmbedding(text),
  isEmbeddingEmpty: (embedding: number[]) => embedding.length === 0,
  buildEmbeddingKey: (input: { summary?: string; windowUse?: string; content?: string }) => {
    const parts = [input.summary?.trim(), input.windowUse?.trim()].filter(Boolean) as string[];
    return parts.length > 0 ? parts.join("\n") : (input.content ?? "").trim();
  },
  buildVectorRecord: async (memoryId: string, text: string) => ({
    memoryId,
    embedding: bigramEmbedding(text),
    model: "eval-bigram",
    dimensions: EVAL_DIMENSIONS,
    updatedAt: SEED,
  }),
}));

import { MemoryService } from "../server/services/memory-service";
import { VectorIndex } from "../lib/vector/index";
import { VectorRetriever } from "../lib/vector/retriever";
import { LOCOMO_MEMORIES, LOCOMO_QUESTIONS } from "./locomo-fixtures";
import { computeMetrics, groupMetrics, RankedHit } from "./metrics";

function seedMemories(db: Database.Database): void {
  const stmt = db.prepare(`
    INSERT INTO memories (
      id, version, source, sourceType, title, content, summary,
      tags, topic, createdAt, updatedAt, accessedAt,
      accessCount, heatScore, vectorId, graphLinks, kind, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const m of LOCOMO_MEMORIES) {
    stmt.run(
      m.id,
      1,
      "locomo-eval",
      "ingest",
      m.title,
      m.content,
      m.summary,
      JSON.stringify(m.tags),
      m.topic,
      m.createdAt,
      m.createdAt,
      m.createdAt,
      0,
      0,
      null,
      JSON.stringify([]),
      "fact",
      "active",
    );
  }
}

/** baseline 臂：embedding 键在 content（改造前的做法） */
function seedVectorsWithContentKey(): void {
  const index = new VectorIndex();
  try {
    for (const m of LOCOMO_MEMORIES) {
      index.create({
        memoryId: m.id,
        embedding: bigramEmbedding(m.content),
        model: "eval-bigram",
        dimensions: EVAL_DIMENSIONS,
        updatedAt: SEED,
      });
    }
  } finally {
    index.close();
  }
}

/** improved 臂：embedding 键 = summary + windowUse（I-11） */
function seedVectorsWithWindowUseKey(): void {
  const index = new VectorIndex();
  try {
    for (const m of LOCOMO_MEMORIES) {
      index.create({
        memoryId: m.id,
        embedding: bigramEmbedding(`${m.summary}\n${m.windowUse}`),
        model: "eval-bigram",
        dimensions: EVAL_DIMENSIONS,
        updatedAt: SEED,
      });
    }
  } finally {
    index.close();
  }
}

async function runVectorOnly(): Promise<RankedHit[]> {
  const index = new VectorIndex();
  try {
    return LOCOMO_QUESTIONS.map((q) => {
      const results = index.search(bigramEmbedding(q.question), 10).map((r) => r.memoryId);
      return { query: q.question, ranked: results, expected: q.expected, group: q.category };
    });
  } finally {
    index.close();
  }
}

async function runImprovedPipeline(): Promise<RankedHit[]> {
  const retriever = new VectorRetriever();
  try {
    const hits: RankedHit[] = [];
    for (const q of LOCOMO_QUESTIONS) {
      // minSimilarity=0：评测关注排序质量，阈值过滤留给真实场景
      const response = await retriever.searchDetailed(q.question, 10, 0);
      hits.push({
        query: q.question,
        ranked: response.results.map((r) => r.memoryId),
        expected: q.expected,
        group: q.category,
      });
    }
    return hits;
  } finally {
    retriever.close();
  }
}

function bareHits(): RankedHit[] {
  // 裸模型（无记忆）：没有任何检索可依赖，只能靠参数化知识
  return LOCOMO_QUESTIONS.map((q) => ({
    query: q.question,
    ranked: [] as string[],
    expected: q.expected,
    group: q.category,
  }));
}

describe("Locomo 风格基准评测（Recall@k / MRR，三组对照）", () => {
  let baselineHits: RankedHit[] = [];
  let improvedHits: RankedHit[] = [];

  beforeAll(() => {
    process.env.VECTOR_BACKEND = "js";
    dbRef.current = new Database(":memory:");
    new MemoryService().close();
    new VectorIndex().close();
    seedMemories(dbRef.current);
    seedVectorsWithContentKey();
  });

  afterAll(() => {
    if (dbRef.current) {
      dbRef.current.close();
      dbRef.current = null;
    }
  });

  it("bare 臂：无记忆时所有指标为 0（对照下界）", () => {
    const bare = bareHits();
    const metrics = computeMetrics(bare);
    expect(metrics.recallAt1).toBe(0);
    expect(metrics.recallAt5).toBe(0);
    expect(metrics.mrr).toBe(0);
  });

  it("baseline 臂（现行 RAG，键在 content）：可测并产出指标", async () => {
    seedVectorsWithContentKey();
    baselineHits = await runVectorOnly();
    const metrics = computeMetrics(baselineHits);
    expect(metrics.total).toBe(LOCOMO_QUESTIONS.length);
    // bigram 向量对字面重合敏感，基线不应为 0
    expect(metrics.recallAt10).toBeGreaterThan(0);
  });

  it("improved 臂（windowUse 键 + 路由融合）：整体 Recall@10 不低于基线", async () => {
    seedVectorsWithWindowUseKey();
    improvedHits = await runImprovedPipeline();
    const improved = computeMetrics(improvedHits);
    const baseline = computeMetrics(baselineHits);

    expect(improved.total).toBe(LOCOMO_QUESTIONS.length);
    // 验收下限：召回池（top-10）不因键改造而缩水
    expect(improved.recallAt10).toBeGreaterThanOrEqual(baseline.recallAt10);
    expect(improved.recallAt10).toBeGreaterThanOrEqual(0.5);
    expect(improved.mrr).toBeGreaterThan(0);
  });

  it("时序类问题在 improved 臂可被召回（temporal group 非零）", () => {
    const temporal = groupMetrics(improvedHits).temporal;
    expect(temporal).toBeDefined();
    expect(temporal.recallAt10).toBeGreaterThan(0);
  });

  it("评测报告写入 evals/reports", () => {
    const report = {
      generatedAt: new Date().toISOString(),
      dataset: {
        sessions: 6,
        memories: LOCOMO_MEMORIES.length,
        questions: LOCOMO_QUESTIONS.length,
      },
      arms: {
        bare: { overall: computeMetrics(bareHits()), byCategory: groupMetrics(bareHits()) },
        baseline: {
          overall: computeMetrics(baselineHits),
          byCategory: groupMetrics(baselineHits),
        },
        improved: {
          overall: computeMetrics(improvedHits),
          byCategory: groupMetrics(improvedHits),
        },
      },
    };

    const reportDir = join(process.cwd(), "evals", "reports");
    mkdirSync(reportDir, { recursive: true });
    writeFileSync(
      join(reportDir, "locomo-eval-report.json"),
      JSON.stringify(report, null, 2),
      "utf-8",
    );
    writeFileSync(join(reportDir, "locomo-eval-report.md"), renderMarkdown(report), "utf-8");

    const saved = JSON.parse(
      readFileSync(join(reportDir, "locomo-eval-report.json"), "utf-8"),
    ) as typeof report;
    expect(Object.keys(saved.arms)).toEqual(["bare", "baseline", "improved"]);
  });
});

function renderMarkdown(report: {
  generatedAt: string;
  dataset: { sessions: number; memories: number; questions: number };
  arms: Record<
    string,
    { overall: RetrievalMetricsLike; byCategory: Record<string, RetrievalMetricsLike> }
  >;
}): string {
  const lines: string[] = [
    "# Locomo 风格基准评测报告",
    "",
    `- 生成时间: ${report.generatedAt}`,
    `- 数据集: ${report.dataset.sessions} 次会话 / ${report.dataset.memories} 张记忆卡 / ${report.dataset.questions} 道事后提问`,
    "- 对照组: bare（无记忆）/ baseline（现行 RAG，键在 content）/ improved（windowUse 键 + 路由融合）",
    "",
    "## 三组对照",
    "",
    "| 对照臂 | Recall@1 | Recall@5 | Recall@10 | MRR |",
    "| --- | --- | --- | --- | --- |",
  ];
  for (const [arm, data] of Object.entries(report.arms)) {
    const m = data.overall;
    lines.push(`| ${arm} | ${m.recallAt1} | ${m.recallAt5} | ${m.recallAt10} | ${m.mrr} |`);
  }
  lines.push("", "## 按推理类型分组", "");
  for (const [arm, data] of Object.entries(report.arms)) {
    lines.push(`### ${arm}`, "");
    lines.push("| 类型 | 查询数 | Recall@1 | Recall@5 | Recall@10 | MRR |");
    lines.push("| --- | --- | --- | --- | --- | --- |");
    for (const [category, m] of Object.entries(data.byCategory)) {
      lines.push(
        `| ${category} | ${m.total} | ${m.recallAt1} | ${m.recallAt5} | ${m.recallAt10} | ${m.mrr} |`,
      );
    }
    lines.push("");
  }
  return lines.join("\n");
}

type RetrievalMetricsLike = {
  total: number;
  recallAt1: number;
  recallAt5: number;
  recallAt10: number;
  mrr: number;
};
