/**
 * 检索评测指标 —— Recall@k 与 MRR（Mean Reciprocal Rank）
 *
 * 纯函数实现，与数据来源无关：输入是"每条查询的召回序列 + 标准答案"，
 * 输出是指标值。评测脚本与单元测试共用。
 */

export type RankedHit = {
  /** 查询标识（用于分组与报告） */
  query: string;
  /** 召回序列（按排名升序），元素为 memoryId */
  ranked: string[];
  /** 标准答案 memoryId */
  expected: string;
  /** 可选分组标签，如查询类型 */
  group?: string;
};

/** 单条查询在 top-k 内是否命中标准答案 */
export function hitAtK(hit: RankedHit, k: number): boolean {
  return hit.ranked.slice(0, k).includes(hit.expected);
}

/** 单条查询的倒数排名（未命中记 0） */
export function reciprocalRank(hit: RankedHit): number {
  const index = hit.ranked.indexOf(hit.expected);
  return index === -1 ? 0 : 1 / (index + 1);
}

/** Recall@k：top-k 命中率。单标准答案场景下等价于 HitRate@k */
export function recallAtK(hits: RankedHit[], k: number): number {
  if (hits.length === 0) return 0;
  return hits.filter((h) => hitAtK(h, k)).length / hits.length;
}

/** MRR：所有查询倒数排名的均值 */
export function mrr(hits: RankedHit[]): number {
  if (hits.length === 0) return 0;
  return hits.reduce((sum, h) => sum + reciprocalRank(h), 0) / hits.length;
}

export type RetrievalMetrics = {
  total: number;
  recallAt1: number;
  recallAt5: number;
  recallAt10: number;
  mrr: number;
};

/** 一次性算出报告所需的全部指标 */
export function computeMetrics(hits: RankedHit[]): RetrievalMetrics {
  return {
    total: hits.length,
    recallAt1: round4(recallAtK(hits, 1)),
    recallAt5: round4(recallAtK(hits, 5)),
    recallAt10: round4(recallAtK(hits, 10)),
    mrr: round4(mrr(hits)),
  };
}

/** 按 group 分组统计 */
export function groupMetrics(hits: RankedHit[]): Record<string, RetrievalMetrics> {
  const groups = new Map<string, RankedHit[]>();
  for (const hit of hits) {
    const key = hit.group ?? "default";
    const list = groups.get(key) ?? [];
    list.push(hit);
    groups.set(key, list);
  }
  const result: Record<string, RetrievalMetrics> = {};
  for (const [key, list] of groups) {
    result[key] = computeMetrics(list);
  }
  return result;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

// ─────────────────────────────────────────────────────────────
// 多标准答案版（真实 LoComo：一道题有多条 evidence，任一命中即算召回）
// ─────────────────────────────────────────────────────────────

export type MultiRankedHit = Omit<RankedHit, "expected"> & { expected: string[] };

/** top-k 内命中任一标准答案 */
export function hitAtKMulti(hit: MultiRankedHit, k: number): boolean {
  const topK = new Set(hit.ranked.slice(0, k));
  return hit.expected.some((id) => topK.has(id));
}

/** 倒数排名取所有标准答案中最先命中的那个 */
export function reciprocalRankMulti(hit: MultiRankedHit): number {
  let best = Number.POSITIVE_INFINITY;
  for (const id of hit.expected) {
    const index = hit.ranked.indexOf(id);
    if (index !== -1 && index < best) best = index;
  }
  return best === Number.POSITIVE_INFINITY ? 0 : 1 / (best + 1);
}

export function computeMetricsMulti(hits: MultiRankedHit[]): RetrievalMetrics {
  if (hits.length === 0) {
    return { total: 0, recallAt1: 0, recallAt5: 0, recallAt10: 0, mrr: 0 };
  }
  return {
    total: hits.length,
    recallAt1: round4(hits.filter((h) => hitAtKMulti(h, 1)).length / hits.length),
    recallAt5: round4(hits.filter((h) => hitAtKMulti(h, 5)).length / hits.length),
    recallAt10: round4(hits.filter((h) => hitAtKMulti(h, 10)).length / hits.length),
    mrr: round4(hits.reduce((sum, h) => sum + reciprocalRankMulti(h), 0) / hits.length),
  };
}

export function groupMetricsMulti(hits: MultiRankedHit[]): Record<string, RetrievalMetrics> {
  const groups = new Map<string, MultiRankedHit[]>();
  for (const hit of hits) {
    const key = hit.group ?? "default";
    const list = groups.get(key) ?? [];
    list.push(hit);
    groups.set(key, list);
  }
  const result: Record<string, RetrievalMetrics> = {};
  for (const [key, list] of groups) {
    result[key] = computeMetricsMulti(list);
  }
  return result;
}
