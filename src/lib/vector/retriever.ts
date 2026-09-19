import { VectorIndex } from "./index";
import { generateEmbedding, isEmbeddingEmpty } from "./generator";
import { MemoryRecord } from "../../types/memory";
import { KeywordIndex, rankByKeywords } from "./keyword-index";
import { classifyQuery, QueryRoute } from "./query-classifier";
import { reciprocalRankFusion, RankedHit } from "./fusion";
import {
  extractDate,
  extractTemporalAnchor,
  rankTemporal,
  stripTemporalClause,
  TemporalMeta,
} from "./temporal";
import { WikiGraph } from "../graph/wiki-graph";
import { recordRouteStat } from "./route-stats";

/**
 * 默认相似度阈值：cosine similarity 低于此值的记忆视为噪声，不返回。
 * 文本 embedding 的 cosine 通常 0.3 以上才有语义相关性，0.3 是经验默认值。
 * 调用方可通过 minSimilarity 参数覆盖（如搜索 API 想看全部结果时传 0）。
 */
const DEFAULT_MIN_SIMILARITY = 0.3;

/** 每路召回的候选池下限：给 RRF 留出跨路重排空间（最终仍截断到 limit） */
const MIN_FUSION_POOL = 20;

export type RetrievalMode = "vector" | "keyword" | "hybrid" | "graph" | "overview" | "temporal";

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
  /**
   * 时序检索的记忆元数据提供器（createdAt + 文本），供锚定日期解析与时间感知排序。
   * 缺省时 temporal 查询退化为常规混合检索，保证功能不缺失。
   */
  temporalMetaProvider?: (memoryIds: string[]) => Promise<TemporalMeta[]>;
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
    // 健康度面板·路由分布：记录分类器决策（旁路统计，失败不影响检索）
    recordRouteStat(route);

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

    // temporal：时间感知检索（阶段二）。锚定解析失败或元数据缺失时
    // 落回下方常规混合检索，保证功能不缺失。
    const pool = Math.max(limit, MIN_FUSION_POOL);
    if (route === "temporal" && this.options.temporalMetaProvider) {
      const temporal = await this.searchTemporal(query, pool);
      if (temporal) {
        return { results: temporal.slice(0, limit), mode: "temporal", route };
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
   * temporal 路由：时间感知检索（阶段二）。
   *
   * 流程：
   * 1. 解析"在 X 之前/之后"锚定子句，剥离得到聚焦意图的查询
   *    （锚定实体是时间参照物，不剥离会成为相似度检索的干扰项）
   * 2. 意图查询走 vector + keyword 双路 RRF
   * 3. 锚定子句存在时：锚文本关键词反查锚定记忆 → 解析锚定日期 → 按方向过滤候选
   * 4. rankTemporal 排序：相似度优先，并列时新者优先
   *
   * 返回 null 表示策略无法落地（无候选 / 锚定无法解析），调用方退化到常规检索。
   */
  private async searchTemporal(query: string, pool: number): Promise<RankedHit[] | null> {
    const metaProvider = this.options.temporalMetaProvider;
    if (!metaProvider) return null;

    const anchor = extractTemporalAnchor(query);
    const intentQuery = anchor ? stripTemporalClause(query) : query;
    if (!intentQuery.trim()) return null;

    // 锚定子句会稀释语义，用意图查询重新生成向量（普通时序问句不变）
    const embedding = await generateEmbedding(intentQuery);
    const vectorHits = isEmbeddingEmpty(embedding) ? [] : this.getIndex().search(embedding, pool);
    const keywordHits = this.getKeywordIndex().search(intentQuery, pool);

    const lists = [vectorHits, keywordHits].filter((list) => list.length > 0);
    if (lists.length === 0) return null;
    const fused = reciprocalRankFusion(lists);

    // 锚定日期解析：锚文本关键词反查命中的记忆，取其 createdAt 或正文日期
    let anchorDate: string | null = null;
    if (anchor) {
      const anchorHits = this.getKeywordIndex().search(anchor.text, 1);
      const anchorMeta = anchorHits.length
        ? (await metaProvider([anchorHits[0].memoryId]))[0]
        : undefined;
      if (anchorMeta) {
        anchorDate =
          anchorMeta.createdAt && anchorMeta.createdAt.length >= 10
            ? anchorMeta.createdAt.slice(0, 10)
            : extractDate(anchorMeta.text ?? "");
      }
      if (!anchorDate) return null;
    }

    const ids = fused.map((hit) => hit.memoryId);
    const metaMap = new Map<string, TemporalMeta>();
    for (const meta of await metaProvider(ids)) {
      metaMap.set(meta.memoryId, meta);
    }

    return rankTemporal(fused, metaMap, anchor, anchorDate);
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
