import { MemoryRecord } from "../../types/memory";

export type RankResult = {
  memoryId: string;
  score: number;
  originalScore: number;
  factors: {
    relevance: number;
    heat: number;
    recency: number;
    access: number;
    tagAffinity: number;
  };
};

/** MMR 重排选项 */
export type MmrOptions = {
  /** 相关性与多样性的平衡系数，默认 0.7（偏向相关性）；α=1 时退化为纯多因子加权排序 */
  alpha?: number;
};

export class Ranker {
  /**
   * 基础多因子加权排序（非 MMR）：
   * score = 0.4*relevance + 0.25*heat + 0.2*recency + 0.1*access + 0.05*tagAffinity
   * 各子项公式与 AGENTS.md 4.10 heatScore 子项一致（recency λ=0.01，半衰期 ~69h）
   */
  rank(
    candidates: { memoryId: string; similarity: number }[],
    memories: Map<string, MemoryRecord>,
    profileTags: string[],
  ): RankResult[] {
    return this.computeBaseScores(candidates, memories, profileTags).sort(
      (a, b) => b.score - a.score,
    );
  }

  /**
   * MMR（Maximal Marginal Relevance）重排：
   * MMR(d) = α * score(d) - (1-α) * max_{d'∈selected} sim(d, d')
   *
   * - score(d) 是基础多因子加权分数（来自 rank 方法）
   * - sim(d, d') 是文档间相似度，用 tags 的 Jaccard 相似度作为代理
   *   （tags 相似度高 → 主题相近 → 应该去重，避免返回主题重复的记忆）
   * - α 控制相关性与多样性的平衡：α=1 退化为纯相关性排序，α=0 纯多样性
   *
   * 算法：贪心迭代，每轮从候选集选出 MMR 最高的文档加入已选集合。
   *
   * 与 AGENTS.md 4.11 "重排默认采用 MMR" 对齐。
   */
  rankWithMMR(
    candidates: { memoryId: string; similarity: number }[],
    memories: Map<string, MemoryRecord>,
    profileTags: string[],
    options?: MmrOptions,
  ): RankResult[] {
    const alpha = options?.alpha ?? 0.7;
    const baseResults = this.computeBaseScores(candidates, memories, profileTags);

    if (baseResults.length <= 1) return baseResults;

    // 已选集合的 memoryId → 对应的 RankResult
    const selected: RankResult[] = [];
    // 候选池（按基础分数降序，便于首轮选择最高分）
    const pool: RankResult[] = [...baseResults].sort((a, b) => b.score - a.score);

    // 首轮：直接选基础分数最高的（无多样性惩罚）
    const first = pool.shift()!;
    selected.push(first);

    // 后续每轮：选 MMR = α*score - (1-α)*max_sim 最高的
    while (pool.length > 0) {
      let bestIdx = 0;
      let bestMmr = -Infinity;

      for (let i = 0; i < pool.length; i++) {
        const candidate = pool[i];
        const candidateMemory = memories.get(candidate.memoryId);
        if (!candidateMemory) continue;

        // 计算 candidate 与已选集合的最大 tags Jaccard 相似度
        let maxSim = 0;
        for (const sel of selected) {
          const selMemory = memories.get(sel.memoryId);
          if (!selMemory) continue;
          const sim = jaccardTags(candidateMemory.tags, selMemory.tags);
          if (sim > maxSim) maxSim = sim;
        }

        const mmr = alpha * candidate.score - (1 - alpha) * maxSim;
        if (mmr > bestMmr) {
          bestMmr = mmr;
          bestIdx = i;
        }
      }

      const chosen = pool.splice(bestIdx, 1)[0];
      // 用 MMR 分数覆盖 score，保留 originalScore 和 factors 供调试
      chosen.score = bestMmr;
      selected.push(chosen);
    }

    return selected;
  }

  /**
   * 计算基础多因子加权分数（rank 和 rankWithMMR 共用）
   */
  private computeBaseScores(
    candidates: { memoryId: string; similarity: number }[],
    memories: Map<string, MemoryRecord>,
    profileTags: string[],
  ): RankResult[] {
    const now = Date.now();
    const maxAccess = Math.max(...Array.from(memories.values()).map((m) => m.accessCount), 1);

    return candidates
      .map((candidate) => {
        const memory = memories.get(candidate.memoryId);
        if (!memory) return null;

        const hoursSinceUpdate = (now - new Date(memory.updatedAt).getTime()) / (1000 * 60 * 60);
        const recencyScore = Math.exp(-0.01 * hoursSinceUpdate);

        const accessScore = Math.log(1 + memory.accessCount) / Math.log(1 + maxAccess);

        const intersection = memory.tags.filter((t) => profileTags.includes(t)).length;
        const union = memory.tags.length + profileTags.length - intersection;
        const tagAffinityScore = union > 0 ? intersection / union : 0;

        const score =
          candidate.similarity * 0.4 +
          memory.heatScore * 0.25 +
          recencyScore * 0.2 +
          accessScore * 0.1 +
          tagAffinityScore * 0.05;

        return {
          memoryId: candidate.memoryId,
          score,
          originalScore: candidate.similarity,
          factors: {
            relevance: candidate.similarity,
            heat: memory.heatScore,
            recency: recencyScore,
            access: accessScore,
            tagAffinity: tagAffinityScore,
          },
        };
      })
      .filter((r): r is RankResult => r !== null);
  }
}

/** 两个 tags 数组的 Jaccard 相似度：|交集| / |并集| */
function jaccardTags(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const t of setA) {
    if (setB.has(t)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union > 0 ? intersection / union : 0;
}
