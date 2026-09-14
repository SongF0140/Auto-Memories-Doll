/**
 * 自适应检索路由分类器（I-8，Adaptive RAG）。
 *
 * RAG / Graph RAG / LLM Wiki 三者不是互斥替代，是**叠加关系**：
 * - Graph RAG 在多跳推理、跨实体关联、全局摘要上有优势
 * - 单跳事实检索上传统 RAG 更简洁高效
 * 因此先用分类器判断问题类型，再路由到对应管线。
 *
 * 起步版本为**纯规则、零 LLM 调用**：分类本身必须是便宜的，
 * 否则路由开销会吃掉融合带来的收益。
 */

export type QueryRoute = "single-hop" | "multi-hop" | "overview" | "temporal";

/** 对比/关系/演进类：需要跨多条记忆做关联推理 */
const MULTI_HOP_PATTERNS = [
  /区别/,
  /对比/,
  /相比/,
  /比较/,
  /优劣/,
  /哪个更/,
  /差异/,
  /之间的关系/,
  /关联/,
  /演进/,
  /先后/,
  /为什么/,
  /如何影响/,
  /导致/,
];

/** 总览/盘点类：直接读编译产物与控制面，不需要向量检索 */
const OVERVIEW_PATTERNS = [
  /总结/,
  /概览/,
  /总览/,
  /梳理/,
  /整体/,
  /所有/,
  /全部/,
  /一共/,
  /有哪些/,
  /清单/,
  /盘点/,
  /现状/,
];

/**
 * 时序/时间定位类：需要按时间定位记忆（阶段二新增，Locomo 跑分显示
 * temporal 组 Recall@1 仅 0.67，根因是时间问句被当普通 single-hop 处理，
 * "在 X 之前最后一次 Y"的锚定语义完全丢失）。
 * 模式保持高精度：只收明确的时间意图词，避免劫持 multi-hop 的"为什么"问句。
 */
const TEMPORAL_PATTERNS = [
  /哪一天/,
  /哪天/,
  /什么时候/,
  /何时/,
  /多久/,
  /最近一次/,
  /最后一次/,
  /上一次/,
  /最早/,
  /最晚/,
  /时间线/,
];

/**
 * 判定查询应走哪条检索管线。
 *
 * @param query 用户查询
 * @param topics 已知话题列表；命中话题时总览类查询才判定为 overview，
 *               避免"总结一下"这类无指向的查询错误地跳过向量检索。
 *               不传 topics 时（调用方没有话题上下文）总览词单独生效。
 */
export function classifyQuery(query: string, topics: string[] = []): QueryRoute {
  const normalized = (query || "").trim();
  if (normalized.length === 0) return "single-hop";

  // temporal 优先级最高：时间意图词比对比/总览词更特异，
  // 且时序问题的正确解法（锚定过滤 + 时间感知排序）与相似度排序根本不同。
  if (TEMPORAL_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return "temporal";
  }

  if (MULTI_HOP_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return "multi-hop";
  }

  if (OVERVIEW_PATTERNS.some((pattern) => pattern.test(normalized))) {
    const topicHit =
      topics.length === 0 || topics.some((topic) => topic && normalized.includes(topic));
    if (topicHit) return "overview";
  }

  return "single-hop";
}
