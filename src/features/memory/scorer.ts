import { MemoryRecord } from "../../types/memory";
import { calculateHeatScore } from "../../config/scoring.config";
import { readProfileTags } from "../../lib/storage/index-writer";

export class MemoryScorer {
  async calculateScore(memory: MemoryRecord, allMemories: MemoryRecord[]): Promise<number> {
    const maxAccessCount = Math.max(...allMemories.map((m) => m.accessCount), 1);
    const maxExposureCount = Math.max(...allMemories.map((m) => m.accessCount), 1);

    const profileTags = await readProfileTags();

    return calculateHeatScore(
      memory.accessCount,
      memory.updatedAt,
      memory.accessCount,
      memory.tags,
      profileTags,
      maxAccessCount,
      maxExposureCount,
    );
  }

  calculateRecencyScore(updatedAt: string): number {
    const hoursSinceUpdate = (Date.now() - new Date(updatedAt).getTime()) / (1000 * 60 * 60);
    return Math.exp(-0.01 * hoursSinceUpdate);
  }

  calculateAccessScore(accessCount: number, maxAccessCount: number): number {
    if (maxAccessCount <= 0) return 0;
    return Math.log(1 + accessCount) / Math.log(1 + maxAccessCount);
  }

  calculateTagAffinityScore(tags: string[], profileTags: string[]): number {
    const intersection = tags.filter((t) => profileTags.includes(t)).length;
    const union = tags.length + profileTags.length - intersection;
    return union > 0 ? intersection / union : 0;
  }
}
