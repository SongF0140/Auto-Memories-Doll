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

export class Ranker {
  rank(
    candidates: { memoryId: string; similarity: number }[],
    memories: Map<string, MemoryRecord>,
    profileTags: string[]
  ): RankResult[] {
    const now = Date.now();
    const maxAccess = Math.max(...Array.from(memories.values()).map(m => m.accessCount), 1);

    return candidates.map(candidate => {
      const memory = memories.get(candidate.memoryId);
      if (!memory) return null;

      const hoursSinceUpdate = (now - new Date(memory.updatedAt).getTime()) / (1000 * 60 * 60);
      const recencyScore = Math.exp(-0.01 * hoursSinceUpdate);
      
      const accessScore = Math.log(1 + memory.accessCount) / Math.log(1 + maxAccess);
      
      const intersection = memory.tags.filter(t => profileTags.includes(t)).length;
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
    }).filter((r): r is RankResult => r !== null)
      .sort((a, b) => b.score - a.score);
  }
}