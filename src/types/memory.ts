/**
 * 记忆数据类型定义
 *
 * 调用关系：
 * - 被引用：features/memory/* （记忆处理）
 * - 被引用：lib/memory/* （记忆抽象）
 * - 被引用：lib/storage/* （本地存储）
 * - 袂引用：lib/vector/* （向量索引）
 * - 袂引用：lib/graph/* （图谱关系）
 *
 * 作用：
 * - 定义 MemoryRecord 主记录类型
 * - 定义 VectorRecord 向量索引类型
 * - 定义 GraphEdge 关系边类型
 * - 定义 MemoryVersion 历史快照类型
 * - 提供类型校验和约束
 */