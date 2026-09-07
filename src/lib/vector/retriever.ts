import { VectorIndex } from "./index";
import { generateEmbedding, isEmbeddingEmpty } from "./generator";
import { MemoryRecord } from "../../types/memory";
import { KeywordIndex, rankByKeywords } from "./keyword-index";
import { classifyQuery, QueryRoute } from "./query-classifier";
import { reciprocalRankFusion, RankedHit } from "./fusion";
import { WikiGraph } from "../graph/wiki-graph";

/**
 * 默认相似度阈值：cosine similarity 低于此值的记忆视为噪声，不返回。
 * 文本 embedding 的 cosine 通常 0.3 以上才有语义相关性，0.3 是经验默认值。
 * 调用方可通过 minSimilarity 参数覆盖（如搜索 API 想看全部结果时传 0）。
 */
const DEFAULT_MIN_SIMILARITY = 0.3;

/** 每路召回的候选池下限：给 RRF 留出跨路重排空间（最终仍截断到 limit） */
const MIN_FUSION_POOL = 20;

export type RetrievalMode = "vector" | "keyword" | "hybrid" | "graph" | "overview";

export type RetrievalSearchResponse = {
  results: { memoryId: string; similarity: number }[];
  mode: RetrievalMode;
  /** I-8 自适应路由：本次查询被判定走的管线，便于统计与调优 */
  route?: QueryRoute;
};

export type VectorRetrieverOptions = {
  /** 图谱邻接扩展（multi-hop 路由用），可注入以便测试 */
  wikiGraph?: Pick<WikiGraph, "getNeighbors">;
  /**
   * overview 路由的结果提供器（读控制面 index.md 与 synthesis 卡）。
   * 缺省时 overview 查询退化为 single-hop，保证无控制面时功能不缺失。
   */
  overviewProvider?: (query: string, limit: number) => Promise<RankedHit[]>;
  /** 话题白名单：用于 overview 路由的话题命中判断 */
  topics?: string[];
};

export class VectorRetriever {
  private index: VectorIndex | null = null;
  private keywordIndex: KeywordIndex | null = null;
  private wikiGraph: Pick<WikiGraph, "getNeighbors"> | null = null;

  constructor(private readonly options: VectorRetrieverOptions = {}) {
    if (options.wikiGraph) this.wikiGraph = options.wikiGraph;
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
   * 自适应路由检索（I-8）：
   * - single-hop：RRF(vector, keyword)
   * - multi-hop：vector 取种子 → wiki-graph 扩 1 跳邻居 → RRF(vector, graph)
   * - overview：直接返回控制面与 synthesis 卡（零 embedding 调用）
   *
   * Embedding 不可用（未配置 Key、API 失败或并发超时）时，
   * 自动降级到关键词检索——这是既有降级语义，路由不改变它。
   */
  async searchDetailed(
    query: string,
    limit: number = 10,
    minSimilarity: number = DEFAULT_MIN_SIMILARITY,
  ): Promise<RetrievalSearchResponse> {
    const route = classifyQuery(query, this.options.topics ?? []);

    // overview：知识已编译，直接读编译产物与控制面，不做向量检索
    if (route === "overview" && this.options.overviewProvider) {
      try {
        const overview = await this.options.overviewProvider(query, limit);
        if (overview.length > 0) {
          return { results: overview.slice(0, limit), mode: "overview", route };
        }
      } catch {
        // 控制面缺失或读取失败 → 退化到常规检索
      }
    }

    const embedding = await generateEmbedding(query);
    if (isEmbeddingEmpty(embedding)) {
      return {
        results: this.getKeywordIndex().search(query, limit),
        mode: "keyword",
        route,
      };
    }

    const pool = Math.max(limit, MIN_FUSION_POOL);
    const vectorHits = this.getIndex()
      .search(embedding, pool)
      .filter((r) => minSimilarity <= 0 || r.similarity >= minSimilarity);

    if (route === "multi-hop") {
      const graphHits = await this.expandByGraph(vectorHits, pool);
      if (graphHits.length > 0) {
        return {
          results: reciprocalRankFusion([vectorHits, graphHits]).slice(0, limit),
          mode: "graph",
          route,
        };
      }
    }

    const keywordHits = this.getKeywordIndex().search(query, pool);
    if (keywordHits.length > 0) {
      return {
        results: reciprocalRankFusion([vectorHits, keywordHits]).slice(0, limit),
        mode: "hybrid",
        route,
      };
    }

    return {
      results: vectorHits.slice(0, limit),
      mode: "vector",
      route,
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

    const index = this.getIndex();
    // ANN 不需要扫描整个记忆集合；扩大候选池后再按允许的 memoryId 过滤。
    // JS 精确后端本身是全量扫描，直接使用当前记忆集合大小避免套用 ANN 候选池规则。
    const candidateLimit =
      index.getBackendName() === "js-exact"
        ? memories.length
        : Math.min(memories.length, Math.max(limit * 4, 50));
    const results = index.search(embedding, candidateLimit);

    const memoryMap = new Map(memories.map((m) => [m.id, m]));

    return results
      .filter((r) => memoryMap.has(r.memoryId))
      .filter((r) => minSimilarity <= 0 || r.similarity >= minSimilarity)
      .map((r) => ({ memory: memoryMap.get(r.memoryId)!, similarity: r.similarity }))
      .slice(0, limit);
  }

  close(): void {
    this.index?.close();
    this.keywordIndex?.close();
    this.index = null;
    this.keywordIndex = null;
    this.wikiGraph = null;
  }

  /**
   * multi-hop 路由：以向量命中的高分段为种子，沿 wikilink 扩 1 跳邻居。
   * 邻居自身没有相似度分值，用"距离种子的排名"衰减生成一个可与余弦分融合的伪分值。
   */
  private async expandByGraph(
    vectorHits: { memoryId: string; similarity: number }[],
    pool: number,
  ): Promise<RankedHit[]> {
    if (vectorHits.length === 0) return [];

    const graph = this.getWikiGraph();
    const seeds = vectorHits.slice(0, 5);
    const seen = new Set(seeds.map((hit) => hit.memoryId));
    const hits: RankedHit[] = [];

    for (let depth = 0; depth < seeds.length; depth++) {
      let neighbors: string[];
      try {
        neighbors = await graph.getNeighbors(seeds[depth].memoryId);
      } catch {
        continue;
      }
      for (const neighborId of neighbors) {
        if (seen.has(neighborId) || hits.some((h) => h.memoryId === neighborId)) continue;
        seen.add(neighborId);
        // 越靠后的种子、其邻居的权重越低
        hits.push({
          memoryId: neighborId,
          similarity: seeds[depth].similarity * (1 - depth * 0.1),
        });
      }
    }

    return hits.sort((a, b) => b.similarity - a.similarity).slice(0, pool);
  }

  private getIndex(): VectorIndex {
    this.index ??= new VectorIndex();
    return this.index;
  }

  private getKeywordIndex(): KeywordIndex {
    this.keywordIndex ??= new KeywordIndex();
    return this.keywordIndex;
  }

  private getWikiGraph(): Pick<WikiGraph, "getNeighbors"> {
    this.wikiGraph ??= new WikiGraph();
    return this.wikiGraph;
  }
}
