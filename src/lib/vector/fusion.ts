import { RRF_K } from "../../config/constants";

export type RankedHit = { memoryId: string; similarity: number };

/**
 * Reciprocal Rank Fusion（RRF）：多路召回融合。
 *
 * score(d) = Σ_i 1 / (k + rank_i(d))，k=60 是标准取值。
 * RRF 只依赖排名而不依赖各路的绝对分值，因此能把量纲完全不同的
 * 向量余弦分、关键词分、图距离放在同一个尺度上融合。
 *
 * 输出 similarity 归一化到 (0, 1]（单路首位命中为 1），
 * 以便下游继续使用既有的 0.3 相似度阈值（红线：阈值语义不变）。
 */
export function reciprocalRankFusion(rankedLists: RankedHit[][], k: number = RRF_K): RankedHit[] {
  const lists = rankedLists.filter((list) => list.length > 0);
  if (lists.length === 0) return [];

  const scores = new Map<string, number>();
  for (const list of lists) {
    list.forEach((hit, index) => {
      if (!hit?.memoryId) return;
      const rank = index + 1;
      scores.set(hit.memoryId, (scores.get(hit.memoryId) ?? 0) + 1 / (k + rank));
    });
  }

  // 理论最大值：每条列表都把它排在第一位
  const maxScore = lists.length / (k + 1);

  return [...scores.entries()]
    .map(([memoryId, score]) => ({ memoryId, similarity: Math.min(1, score / maxScore) }))
    .sort((a, b) => b.similarity - a.similarity);
}
