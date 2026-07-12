/**
 * 向量重排器
 *
 * 调用关系：
 * - 被调用：lib/vector/retriever.ts
 *
 * 作用：
 * - 对检索结果进行重排
 * - 默认采用 MMR（Maximal Marginal Relevance）
 * - 可切换为交叉编码器重排（更高精度）
 * - 考虑相关度、热度、最近更新、访问次数和个性标签偏置
 */