import { VectorIndex } from "./index";
import { generateEmbedding } from "./generator";
import { MemoryRecord } from "../../types/memory";

/**
 * 默认相似度阈值：cosine similarity 低于此值的记忆视为噪声，不返回。
 * 文本 embedding 的 cosine 通常 0.3 以上才有语义相关性，0.3 是经验默认值。
 * 调用方可通过 minSimilarity 参数覆盖（如搜索 API 想看全部结果时传 0）。
 */
const DEFAULT_MIN_SIMILARITY = 0.3;

export class VectorRetriever {
  private index: VectorIndex;

  constructor() {
    this.index = new VectorIndex();
  }

  /**
   * 向量语义检索：生成 query embedding → 余弦相似度排序 → 阈值过滤 → top-N
   * @param minSimilarity 相似度下限，默认 0.3；传 0 或负数则不过滤
   */
  async search(
    query: string,
    limit: number = 10,
    minSimilarity: number = DEFAULT_MIN_SIMILARITY,
  ): Promise<{ memoryId: string; similarity: number }[]> {
    const embedding = await generateEmbedding(query);
    const results = this.index.search(embedding, limit);
    return minSimilarity > 0
      ? results.filter((r) => r.similarity >= minSimilarity)
      : results;
  }

  /**
   * 向量检索并关联 MemoryRecord：在 searchWithMemories 场景下，
   * 先取 memories.length 个候选保证池子足够大，再过滤阈值和映射记录，最后截断到 limit。
   */
  async searchWithMemories(
    query: string,
    memories: MemoryRecord[],
    limit: number = 10,
    minSimilarity: number = DEFAULT_MIN_SIMILARITY,
  ): Promise<{ memory: MemoryRecord; similarity: number }[]> {
    const embedding = await generateEmbedding(query);
    const results = this.index.search(embedding, memories.length);

    const memoryMap = new Map(memories.map((m) => [m.id, m]));

    return results
      .filter((r) => memoryMap.has(r.memoryId))
      .filter((r) => minSimilarity <= 0 || r.similarity >= minSimilarity)
      .map((r) => ({ memory: memoryMap.get(r.memoryId)!, similarity: r.similarity }))
      .slice(0, limit);
  }

  close(): void {
    this.index.close();
  }
}
