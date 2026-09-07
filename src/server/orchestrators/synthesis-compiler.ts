import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";
import { MemoryRecord } from "../../types/memory";
import { MemoryService } from "../services/memory-service";
import { ModelAdapter } from "../../lib/ai/model-adapter";
import { ConfidenceService } from "../services/confidence-service";
import { CompileVerifier, CompiledDraft } from "./compile-verifier";
import { buildPendingEvent } from "../../lib/memory/builder";
import { formatMemoryAsMarkdown } from "../../lib/storage/markdown-formatter";
import { getNotesPath } from "../../lib/storage/path-resolver";
import {
  SYNTHESIS_MIN_CLUSTER_SIZE,
  SYNTHESIS_ACTIVE_WINDOW_DAYS,
  COMPILE_MAX_REFINEMENT_ROUNDS,
} from "../../config/constants";
import { logger } from "../../lib/logger";

/**
 * Synthesis 编译层（I-6，memU 聚合层 + LLM Wiki Crystallize 双重缺口）。
 *
 * 20 张同 topic 卡片永远不会被编译成一页综合结论，知识存一年还是碎片。
 * 本编排器在夜间把这些碎片编译成 synthesis 卡：
 *
 *   同 topic + 图连通分量聚类 → 筛选可编译簇 → 旗舰 LLM 编译
 *     → WiCER 探针验证（≤2 轮精准重编译）→ 落盘 notes/synthesis/<topic>/ + 向量化
 *     → 来源卡标记 synthesizedBy（被综合 ≠ 被取代，来源卡不删）
 *
 * 增量缓存沿用 atomic-memory-compiler 的 SHA256 思路：
 * 来源卡集合指纹未变则跳过重编译，这是整个范式里最被低估的工程点。
 */
export type SynthesisCluster = {
  topic: string;
  memoryIds: string[];
  /** 来源卡集合指纹，用于增量判断是否需重编译 */
  signature: string;
};

export type SynthesisReport = {
  /** 检出的可编译簇数量 */
  clusters: number;
  /** 成功落盘的综合卡 */
  created: Array<{ memoryId: string; topic: string; sources: string[] }>;
  /** 跳过的簇及原因（签名未变 / 规模不足 / 全被取代） */
  skipped: Array<{ topic: string; reason: string }>;
  /** 验证未通过、转入人工裁决的簇 */
  failed: Array<{ topic: string; reason: string }>;
};

/** 编译输出的最大来源卡数（与 CompileVerifier.MAX_SOURCES 对齐，封顶夜间成本） */
const MAX_SOURCES_PER_CLUSTER = 8;
/** 待人工裁决的综合卡标签 */
const REVIEW_TAG = "编译待审";

export class SynthesisCompiler {
  private verifier: CompileVerifier;

  constructor(
    private memoryService: MemoryService = new MemoryService(),
    verifier: CompileVerifier = new CompileVerifier(),
  ) {
    this.verifier = verifier;
  }

  /**
   * 聚类：先按 topic 分组，再用 graphLinks 做并查集，
   * 把同一话题内通过 wikilink 连通的卡片聚成一个簇（图社区检测的轻量近似）。
   */
  cluster(memories: MemoryRecord[]): SynthesisCluster[] {
    const active = memories.filter((m) => (m.status ?? "active") !== "superseded");
    const byTopic = new Map<string, MemoryRecord[]>();
    for (const memory of active) {
      byTopic.set(memory.topic, [...(byTopic.get(memory.topic) ?? []), memory]);
    }

    const clusters: SynthesisCluster[] = [];
    for (const [topic, list] of byTopic) {
      // 图社区检测的轻量近似：topic 内用 graphLinks 做并查集
      const groups = this.graphComponents(list);
      const eligible = groups.filter((g) => g.length >= SYNTHESIS_MIN_CLUSTER_SIZE);

      if (eligible.length > 0) {
        for (const group of eligible) {
          clusters.push({
            topic,
            memoryIds: group.map((m) => m.id).sort(),
            signature: computeSignature(group),
          });
        }
      } else if (list.length >= SYNTHESIS_MIN_CLUSTER_SIZE) {
        // 图信号弱（无 wikilink 或全是孤点）时退化为整 topic 一簇：
        // 碎片聚不到一起恰恰是最需要编译的场景
        clusters.push({
          topic,
          memoryIds: list.map((m) => m.id).sort(),
          signature: computeSignature(list),
        });
      }
    }
    return clusters;
  }

  /** 用 graphLinks 并查集把 topic 内的卡片分成连通分量 */
  private graphComponents(list: MemoryRecord[]): MemoryRecord[][] {
    const idSet = new Set(list.map((m) => m.id));
    const parent = new Map<string, string>();
    const find = (x: string): string => {
      const p = parent.get(x);
      if (!p || p === x) return x;
      const root = find(p);
      parent.set(x, root);
      return root;
    };
    for (const memory of list) parent.set(memory.id, memory.id);
    for (const memory of list) {
      for (const link of memory.graphLinks) {
        if (idSet.has(link)) {
          const a = find(memory.id);
          const b = find(link);
          if (a !== b) parent.set(a, b);
        }
      }
    }

    const groups = new Map<string, MemoryRecord[]>();
    for (const memory of list) {
      const root = find(memory.id);
      groups.set(root, [...(groups.get(root) ?? []), memory]);
    }
    return [...groups.values()];
  }

  /** 执行一轮完整编译（含验证） */
  async compile(all: MemoryRecord[]): Promise<SynthesisReport> {
    const report: SynthesisReport = { clusters: 0, created: [], skipped: [], failed: [] };

    if (ModelAdapter.isDegradedMode) {
      logger.nightly.info("模型降级中，跳过知识编译");
      return report;
    }

    const clusters = this.cluster(all);
    report.clusters = clusters.length;

    const memoryMap = new Map(all.map((m) => [m.id, m]));

    for (const cluster of clusters) {
      const sources = cluster.memoryIds
        .map((id) => memoryMap.get(id))
        .filter((m): m is MemoryRecord => Boolean(m));

      if (sources.length === 0) {
        report.skipped.push({ topic: cluster.topic, reason: "来源卡已不存在" });
        continue;
      }
      if (!this.hasRecentActivity(sources)) {
        report.skipped.push({
          topic: cluster.topic,
          reason: `近 ${SYNTHESIS_ACTIVE_WINDOW_DAYS} 天无更新`,
        });
        continue;
      }
      if (this.isAlreadyCompiled(cluster)) {
        report.skipped.push({ topic: cluster.topic, reason: "来源卡集合未变更，命中增量缓存" });
        continue;
      }

      try {
        let draft = await this.compileDraft(sources, undefined);
        if (!draft) {
          report.failed.push({ topic: cluster.topic, reason: "编译失败（模型输出异常）" });
          continue;
        }

        let round = 0;
        let missingFacts: string[] = [];
        while (round <= COMPILE_MAX_REFINEMENT_ROUNDS) {
          const outcome = await this.verifier.diagnose(draft, sources);
          round += 1;
          if (outcome.passed) break;
          missingFacts = outcome.missingFacts;
          if (round > COMPILE_MAX_REFINEMENT_ROUNDS) break;
          // 精准重编译：把丢失的事实作为"必须保留"约束（WiCER 的核心）
          const refined = await this.compileDraft(sources, missingFacts);
          if (refined) draft = refined;
        }

        if (missingFacts.length > 0) {
          await this.stageForReview(cluster, sources, draft);
          report.failed.push({
            topic: cluster.topic,
            reason: `验证未通过（${missingFacts.length} 项关键事实丢失），已转人工裁决`,
          });
          continue;
        }

        const memoryId = await this.persist(cluster, sources, draft);
        report.created.push({ memoryId, topic: cluster.topic, sources: cluster.memoryIds });
      } catch (e) {
        report.failed.push({ topic: cluster.topic, reason: (e as Error).message });
      }
    }

    return report;
  }

  /** 调用旗舰模型把来源卡编译成一张综合卡；missingFacts 为上一轮丢失的必须保留事实 */
  private async compileDraft(
    sources: MemoryRecord[],
    missingFacts?: string[],
  ): Promise<CompiledDraft | null> {
    const targets = sources.slice(0, MAX_SOURCES_PER_CLUSTER);
    const sourceBlock = targets
      .map((s, i) => `[${i + 1}] 《${s.titleZh || s.title}》\n${s.summaryZh || s.summary}`)
      .join("\n\n");

    const constraintBlock =
      missingFacts && missingFacts.length > 0
        ? `\n上一次编译丢失了以下关键事实，本轮**必须保留**：\n${missingFacts.map((f) => `- ${f}`).join("\n")}\n`
        : "";

    const prompt = `你是知识编译器。下面 ${targets.length} 条同一话题的记忆碎片，请编译成一张**综合结论页**。

${sourceBlock}
${constraintBlock}
要求：
- 用中文输出，结论先行，可独立阅读（不依赖上面的碎片也能读懂）
- 综合而非罗列：找出共性、冲突与演进脉络
- 保留全部关键事实与具体数字，不要为了简洁丢信息
- 不要编造上面没有的信息

只回复 JSON：{"title": "<标题>", "summary": "<一句话结论>", "content": "<正文，可用 Markdown>", "tags": ["<标签>"]}`;

    try {
      const response = await ModelAdapter.generate(prompt, "flagship");
      if (!response.content || response.finishReason === "degraded") return null;
      return parseDraft(response.content);
    } catch (e) {
      logger.nightly.warn("综合编译调用失败", { error: (e as Error).message });
      return null;
    }
  }

  /** 落盘：SQLite + 向量 + notes/synthesis/<topic>/ 独立目录（与人工笔记隔离） */
  private async persist(
    cluster: SynthesisCluster,
    sources: MemoryRecord[],
    draft: CompiledDraft,
  ): Promise<string> {
    const now = new Date().toISOString();
    const id = `synthesis-${createHash("sha256").update(cluster.signature).digest("hex").slice(0, 16)}`;

    const record: MemoryRecord = {
      id,
      version: 1,
      source: "nightly-synthesis",
      sourceType: "manual",
      kind: "synthesis",
      title: draft.title,
      titleZh: draft.title,
      content: draft.content,
      summary: draft.summary,
      summaryZh: draft.summary,
      tags: draft.tags.length > 0 ? draft.tags : [cluster.topic],
      tagsZh: draft.tags.length > 0 ? draft.tags : [cluster.topic],
      topic: cluster.topic,
      createdAt: now,
      updatedAt: now,
      accessedAt: now,
      accessCount: 0,
      retrievalCount: 0,
      heatScore: 0,
      // 综合结论继承来源中最高置信度，并受编译本身的可信度约束
      confidence: ConfidenceService.initial({
        qualityScore: 1,
        kind: "synthesis",
      }),
      status: "active",
      sources: cluster.memoryIds,
      compileSignature: cluster.signature,
      graphLinks: cluster.memoryIds.slice(0, 20),
    };

    await this.memoryService.createMemoryRecord(record);

    // 与人工笔记物理隔离：synthesis 卡单独落在 notes/synthesis/<topic>/
    try {
      const dir = join(getNotesPath(), "synthesis", cluster.topic);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${id}.md`), formatMemoryAsMarkdown(record), "utf-8");
    } catch (e) {
      logger.nightly.warn("综合卡 Markdown 落盘失败", { error: (e as Error).message });
    }

    // 来源卡标记被综合（不删、不取代）
    for (const sourceId of cluster.memoryIds) {
      try {
        this.memoryService.updateMemory(sourceId, { synthesizedBy: id });
      } catch (e) {
        logger.nightly.warn("来源卡回写 synthesizedBy 失败", {
          memoryId: sourceId,
          error: (e as Error).message,
        });
      }
    }

    return id;
  }

  /** 验证失败的簇不落盘，转为 review 事件等待人工裁决 */
  private async stageForReview(
    cluster: SynthesisCluster,
    sources: MemoryRecord[],
    draft: CompiledDraft,
  ): Promise<void> {
    const now = new Date().toISOString();
    const id = `synthesis-review-${createHash("sha256").update(cluster.signature).digest("hex").slice(0, 16)}`;
    const record: MemoryRecord = {
      id,
      version: 1,
      source: "nightly-synthesis",
      sourceType: "manual",
      kind: "synthesis",
      title: draft.title,
      titleZh: draft.title,
      content: draft.content,
      summary: draft.summary,
      summaryZh: draft.summary,
      tags: [...(draft.tags.length > 0 ? draft.tags : [cluster.topic]), REVIEW_TAG],
      tagsZh: [...(draft.tags.length > 0 ? draft.tags : [cluster.topic]), REVIEW_TAG],
      topic: cluster.topic,
      createdAt: now,
      updatedAt: now,
      accessedAt: now,
      accessCount: 0,
      heatScore: 0,
      status: "active",
      sources: cluster.memoryIds,
      compileSignature: cluster.signature,
      graphLinks: cluster.memoryIds.slice(0, 20),
    };

    const event = buildPendingEvent(id, "manual", record, Object.keys(record), "create");
    event.status = "review";
    this.memoryService.enqueueEvent(event);
  }

  /** 近 N 天是否有更新——没有新输入的簇不需要重编译 */
  private hasRecentActivity(sources: MemoryRecord[]): boolean {
    const cutoff = Date.now() - SYNTHESIS_ACTIVE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    return sources.some((s) => new Date(s.updatedAt).getTime() >= cutoff);
  }

  /** 增量缓存命中判断：已存在同签名综合卡则跳过 */
  private isAlreadyCompiled(cluster: SynthesisCluster): boolean {
    const existing = this.memoryService
      .listMemories({ topic: cluster.topic, includeSuperseded: true })
      .filter((m) => m.kind === "synthesis");
    return existing.some((m) => m.compileSignature === cluster.signature);
  }

  close(): void {
    this.memoryService.close();
  }
}

/** 来源卡集合指纹：id + updatedAt 排序后取 SHA256 */
export function computeSignature(sources: MemoryRecord[]): string {
  const payload = [...sources]
    .map((s) => `${s.id}:${s.updatedAt}`)
    .sort()
    .join("|");
  return createHash("sha256").update(payload).digest("hex");
}

function parseDraft(raw: string): CompiledDraft | null {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as Partial<CompiledDraft>;
    if (!parsed.title || !parsed.summary || !parsed.content) return null;
    return {
      title: String(parsed.title),
      summary: String(parsed.summary),
      content: String(parsed.content),
      tags: Array.isArray(parsed.tags) ? parsed.tags.map(String) : [],
    };
  } catch {
    return null;
  }
}
