import { MemoryRecord } from "../../types/memory";
import { calculateHeatScore } from "../../config/scoring.config";
import { MemoryService } from "../../server/services/memory-service";
import { readProfileTags } from "../../lib/storage/index-writer";

export class MemoryProcessor {
  private memoryService: MemoryService;

  constructor() {
    this.memoryService = new MemoryService();
  }

  async processMemory(memory: MemoryRecord): Promise<MemoryRecord> {
    const allMemories = this.memoryService.listMemories();

    const maxAccessCount = Math.max(...allMemories.map((m) => m.accessCount), 1);
    const maxExposureCount = Math.max(...allMemories.map((m) => m.accessCount), 1);

    const profileTags = await readProfileTags();

    const heatScore = calculateHeatScore(
      memory.accessCount,
      memory.updatedAt,
      memory.accessCount,
      memory.tags,
      profileTags,
      maxAccessCount,
      maxExposureCount,
    );

    return { ...memory, heatScore };
  }

  async updateHeatScores(): Promise<void> {
    const allMemories = this.memoryService.listMemories();
    const profileTags = await readProfileTags();

    const maxAccessCount = Math.max(...allMemories.map((m) => m.accessCount), 1);
    const maxExposureCount = Math.max(...allMemories.map((m) => m.accessCount), 1);

    for (const memory of allMemories) {
      const heatScore = calculateHeatScore(
        memory.accessCount,
        memory.updatedAt,
        memory.accessCount,
        memory.tags,
        profileTags,
        maxAccessCount,
        maxExposureCount,
      );

      this.memoryService.updateMemory(memory.id, { heatScore });
    }
  }

  close(): void {
    this.memoryService.close();
  }
}
