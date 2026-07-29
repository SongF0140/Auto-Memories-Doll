import { VectorIndex } from "./index";
import { generateEmbedding } from "./generator";
import { MemoryRecord } from "../../types/memory";

export class VectorRetriever {
  private index: VectorIndex;

  constructor() {
    this.index = new VectorIndex();
  }

  async search(
    query: string,
    limit: number = 10,
  ): Promise<{ memoryId: string; similarity: number }[]> {
    const embedding = await generateEmbedding(query);
    return this.index.search(embedding, limit);
  }

  async searchWithMemories(
    query: string,
    memories: MemoryRecord[],
    limit: number = 10,
  ): Promise<{ memory: MemoryRecord; similarity: number }[]> {
    const embedding = await generateEmbedding(query);
    const results = this.index.search(embedding, memories.length);

    const memoryMap = new Map(memories.map((m) => [m.id, m]));

    return results
      .filter((r) => memoryMap.has(r.memoryId))
      .map((r) => ({ memory: memoryMap.get(r.memoryId)!, similarity: r.similarity }))
      .slice(0, limit);
  }

  close(): void {
    this.index.close();
  }
}
