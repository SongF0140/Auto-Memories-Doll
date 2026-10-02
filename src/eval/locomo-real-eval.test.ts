/**
 * 真实 LoComo 数据集检索评测（差距分析后续优先级 #2）
 *
 * 数据：snap-research/locomo 官方 locomo10.json（10 段超长多人对话，~5900 轮），
 * 经 `npm run eval:prepare-locomo` 提取为 evals/fixtures/locomo-real.json
 * （轮次卡 + QA evidence 指针；category 4 open-domain 与无法解析的 evidence 已剔除）。
 *
 * 与 locomo-eval.test.ts（自建 fixture）的差异：数据真实、evidence 为多条指针集合，
 * 指标用 MultiRankedHit（任一 evidence 进入 top-k 即算命中）。
 *
 * 三组对照：
 * - bare     裸模型（无记忆检索）
 * - baseline 向量单路（embedding 键 = 轮次文本）
 * - improved I-8 自适应路由 + RRF 混合（vector + keyword + temporal 路由）
 *
 * fixture 缺失时整组跳过（CI 与未准备数据的机器保持绿色）。
 * 运行：先 `npm run eval:prepare-locomo`，再 `npm run eval:locomo:real`；
 * fixture 就位后也会随 `npm test` 一起执行，作为回归基线。
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import Database from "better-sqlite3";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const FIXTURE_PATH = join(process.cwd(), "evals", "fixtures", "locomo-real.json");
/** 评测取前 N 段对话（全量 10 段约 5900 卡 / 1136 题，按需调大） */
const SAMPLE_COUNT = 3;

const fixtureExists = existsSync(FIXTURE_PATH);

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

vi.mock("../lib/vector/generator", () => ({
  generateEmbedding: async (text: string) => bigramEmbedding(text),
  isEmbeddingEmpty: (embedding: number[]) => embedding.length === 0,
  buildEmbeddingKey: (input: { summary?: string; windowUse?: string; content?: string }) =>
    input.content?.trim() || input.summary?.trim() || "",
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
import { computeMetricsMulti, groupMetricsMulti, MultiRankedHit } from "./metrics";

type RealMemory = {
  id: string;
  sessionId: number;
  turn: number;
  speaker: string;
  datetime: string;
  text: string;
};
type RealQuestion = {
  id: string;
  question: string;
  answer: string;
  category: number;
  categoryName: string;
  evidence: string[];
};
type RealFixture = {
  sourceUrl: string;
  generatedAt: string;
  samples: { sampleId: string; memories: RealMemory[]; questions: RealQuestion[] }[];
};

const fixture: RealFixture | null = fixtureExists
  ? (JSON.parse(readFileSync(FIXTURE_PATH, "utf-8")) as RealFixture)
  : null;
const activeSamples = fixture ? fixture.samples.slice(0, SAMPLE_COUNT) : [];
const REAL_MEMORIES: RealMemory[] = activeSamples.flatMap((s) => s.memories);
const REAL_QUESTIONS: RealQuestion[] = activeSamples.flatMap((s) => s.questions);

function seedMemories(db: Database.Database): void {
  const stmt = db.prepare(`
    INSERT INTO memories (
      id, version, source, sourceType, title, content, summary,
      tags, topic, createdAt, updatedAt, accessedAt,
      accessCount, heatScore, vectorId, graphLinks, kind, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const m of REAL_MEMORIES) {
    stmt.run(
      m.id,
      1,
      "locomo-real-eval",
      "ingest",
      `session${m.sessionId}-turn${m.turn} ${m.speaker}`,
      m.text,
      m.text,
      JSON.stringify([m.speaker]),
      m.id.split(":")[0],
      m.datetime,
      m.datetime,
      m.datetime,
      0,
      0,
      null,
      JSON.stringify([]),
      "fact",
      "active",
    );
  }
}

/** baseline / improved 共用：embedding 键 = 轮次文本（真实数据无 summary/windowUse 概念） */
function seedVectors(): void {
  const index = new VectorIndex();
  try {
    for (const m of REAL_MEMORIES) {
      index.create({
        memoryId: m.id,
        embedding: bigramEmbedding(m.text),
        model: "eval-bigram",
        dimensions: EVAL_DIMENSIONS,
        updatedAt: SEED,
      });
    }
  } finally {
    index.close();
  }
}

async function runVectorOnly(): Promise<MultiRankedHit[]> {
  const index = new VectorIndex();
  try {
    return REAL_QUESTIONS.map((q) => ({
      query: q.question,
      ranked: index.search(bigramEmbedding(q.question), 10).map((r) => r.memoryId),
      expected: q.evidence,
      group: q.categoryName,
    }));
  } finally {
    index.close();
  }
}

async function runImprovedPipeline(): Promise<MultiRankedHit[]> {
  const retriever = new VectorRetriever({
    temporalMetaProvider: async (ids) =>
      REAL_MEMORIES.filter((m) => ids.includes(m.id)).map((m) => ({
        memoryId: m.id,
        createdAt: m.datetime,
        text: m.text,
      })),
  });
  try {
    const hits: MultiRankedHit[] = [];
    for (const q of REAL_QUESTIONS) {
      const response = await retriever.searchDetailed(q.question, 10, 0);
      hits.push({
        query: q.question,
        ranked: response.results.map((r) => r.memoryId),
        expected: q.evidence,
        group: q.categoryName,
      });
    }
    return hits;
  } finally {
    retriever.close();
  }
}

describe.skipIf(!fixtureExists)("真实 LoComo 检索评测（Recall@k / MRR，多 evidence 命中）", () => {
  let baselineHits: MultiRankedHit[] = [];
  let improvedHits: MultiRankedHit[] = [];

  beforeAll(async () => {
    process.env.VECTOR_BACKEND = "js";
    dbRef.current = new Database(":memory:");
    new MemoryService().close();
    seedMemories(dbRef.current);
    seedVectors();
    baselineHits = await runVectorOnly();
    improvedHits = await runImprovedPipeline();
  }, 180_000);

  afterAll(() => {
    if (dbRef.current) {
      dbRef.current.close();
      dbRef.current = null;
    }
  });

  it("数据规模符合预期（样本数 / 卡片数 / 问题数）", () => {
    expect(activeSamples.length).toBe(Math.min(SAMPLE_COUNT, fixture!.samples.length));
    expect(REAL_MEMORIES.length).toBeGreaterThan(500);
    expect(REAL_QUESTIONS.length).toBeGreaterThan(100);
  });

  it("baseline 臂：向量单路在真实数据上非零", () => {
    const metrics = computeMetricsMulti(baselineHits);
    expect(metrics.total).toBe(REAL_QUESTIONS.length);
    expect(metrics.recallAt10).toBeGreaterThan(0);
    expect(metrics.mrr).toBeGreaterThan(0);
  });

  it("improved 臂：MRR 不低于向量单路，Recall@10 在容差内持平", () => {
    const improved = computeMetricsMulti(improvedHits);
    const baseline = computeMetricsMulti(baselineHits);
    // 真实数据实测（3 样本）：improved 的 MRR / R@5 / temporal 显著更优，
    // 但 keyword 路在 adversarial 组引入噪声，整体 R@10 常有 ±pp 级抖动——
    // 验收口径：排序质量（MRR）不回归，召回池（R@10）容差 -0.02。
    expect(improved.mrr).toBeGreaterThanOrEqual(baseline.mrr);
    expect(improved.recallAt10).toBeGreaterThanOrEqual(baseline.recallAt10 - 0.02);
  });

  it("temporal 分组在 improved 臂可召回", () => {
    const temporal = groupMetricsMulti(improvedHits).temporal;
    expect(temporal).toBeDefined();
    expect(temporal.recallAt10).toBeGreaterThan(0);
  });

  it("评测报告写入 evals/reports/locomo-real-eval-report.{json,md}", () => {
    const report = {
      generatedAt: new Date().toISOString(),
      dataset: {
        source: fixture!.sourceUrl,
        samples: activeSamples.map((s) => s.sampleId),
        memories: REAL_MEMORIES.length,
        questions: REAL_QUESTIONS.length,
      },
      arms: {
        bare: {
          overall: computeMetricsMulti(
            REAL_QUESTIONS.map((q) => ({
              query: q.question,
              ranked: [],
              expected: q.evidence,
              group: q.categoryName,
            })),
          ),
          byCategory: {},
        },
        baseline: {
          overall: computeMetricsMulti(baselineHits),
          byCategory: groupMetricsMulti(baselineHits),
        },
        improved: {
          overall: computeMetricsMulti(improvedHits),
          byCategory: groupMetricsMulti(improvedHits),
        },
      },
    };

    const reportDir = join(process.cwd(), "evals", "reports");
    mkdirSync(reportDir, { recursive: true });
    writeFileSync(
      join(reportDir, "locomo-real-eval-report.json"),
      JSON.stringify(report, null, 2),
      "utf-8",
    );
    writeFileSync(join(reportDir, "locomo-real-eval-report.md"), renderMarkdown(report), "utf-8");

    const saved = JSON.parse(
      readFileSync(join(reportDir, "locomo-real-eval-report.json"), "utf-8"),
    ) as typeof report;
    expect(Object.keys(saved.arms)).toEqual(["bare", "baseline", "improved"]);
  });
});

function renderMarkdown(report: {
  generatedAt: string;
  dataset: { samples: string[]; memories: number; questions: number };
  arms: Record<
    string,
    { overall: RetrievalMetricsLike; byCategory: Record<string, RetrievalMetricsLike> }
  >;
}): string {
  const lines: string[] = [
    "# 真实 LoComo 检索评测报告",
    "",
    `- 生成时间: ${report.generatedAt}`,
    `- 样本: ${report.dataset.samples.join(", ")}`,
    `- 规模: ${report.dataset.memories} 张轮次卡 / ${report.dataset.questions} 道问题（多 evidence，任一命中算召回）`,
    "- 对照组: bare（无记忆）/ baseline（向量单路）/ improved（自适应路由 + RRF 混合）",
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
    if (Object.keys(data.byCategory).length === 0) continue;
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
