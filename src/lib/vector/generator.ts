/**
 * 向量生成器
 *
 * 调用关系：
 * - 被调用：features/memory/processor.ts
 * - 调用：外部 Embedding API（text-embedding-3-small）
 *
 * 作用：
 * - 生成记忆内容的 embedding
 * - 使用 text-embedding-3-small 模型（默认）
 * - 生成 VectorRecord 并同步向量索引
 */