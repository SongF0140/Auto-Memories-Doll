import { VectorIndex } from "./index";
import { generateEmbedding, isEmbeddingEmpty } from "./generator";
import { MemoryRecord } from "../../types/memory";
import { KeywordIndex, rankByKeywords } from "./keyword-index";

/**
 * 默认相似度阈值：cosine similarity 低于此值的记忆视为噪声，不返回。
 * 文本 embedding 的 cosine 通常 0.3 以上才有语义相关性，0.3 是经验默认值。
 * 调用方可通过 minSimilarity 参数覆盖（如搜索 API 想看全部结果时传 0）。
 */
const DEFAULT_MIN_SIMILARITY = 0.3;

export type RetrievalMode = "vector" | "keyword";

export type RetrievalSearchResponse = {
  results: { memoryId: string; similarity: number }[];
  mode: RetrievalMode;
};

export class VectorRetriever {
  private index: VectorIndex;
  private keywordIndex: KeywordIndex;

  constructor() {
    this.index = new VectorIndex();
    this.keywordIndex = new KeywordIndex();
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
    const response = await this.searchDetailed(query, limit, minSimilarity);
    return response.results;
  }

  /**
   * 返回召回结果及实际使用的模式。Embedding 为空（未配置 Key、API 失败或并发超时）时，
   * 自动切换到标题、正文、摘要、标签和主题的关键词检索。
   */
  async searchDetailed(
    query: string,
    limit: number = 10,
    minSimilarity: number = DEFAULT_MIN_SIMILARITY,
  ): Promise<RetrievalSearchResponse> {
    const embedding = await generateEmbedding(query);
    if (isEmbeddingEmpty(embedding)) {
      return {
        results: this.keywordIndex.search(query, limit),
        mode: "keyword",
      };
    }

    const results = this.index.search(embedding, limit);
    return {
      results: minSimilarity > 0 ? results.filter((r) => r.similarity >= minSimilarity) : results,
      mode: "vector",
    };
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
    if (isEmbeddingEmpty(embedding)) {
      const keywordResults = rankByKeywords(query, memories, limit);
      const memoryMap = new Map(memories.map((memory) => [memory.id, memory]));
      return keywordResults.map((result) => ({
        memory: memoryMap.get(result.memoryId)!,
        similarity: result.similarity,
      }));
    }

    // ANN 不需要扫描整个记忆集合；扩大候选池后再按允许的 memoryId 过滤。
    // 4x/至少 50 条能兼顾选定子集过滤与查询延迟。
    const candidateLimit = Math.min(memories.length, Math.max(limit * 4, 50));
    const results = this.index.search(embedding, candidateLimit);

    const memoryMap = new Map(memories.map((m) => [m.id, m]));

    return results
      .filter((r) => memoryMap.has(r.memoryId))
      .filter((r) => minSimilarity <= 0 || r.similarity >= minSimilarity)
      .map((r) => ({ memory: memoryMap.get(r.memoryId)!, similarity: r.similarity }))
      .slice(0, limit);
  }

  close(): void {
    this.index.close();
    this.keywordIndex.close();
  }
}
