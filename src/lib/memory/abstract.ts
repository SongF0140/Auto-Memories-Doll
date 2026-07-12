/**
 * 记忆抽象层
 *
 * 调用关系：
 * - 被调用：features/memory/* （记忆处理）
 * - 调用：lib/storage/* （本地存储）
 * - 调用：lib/vector/* （向量索引）
 * - 调用：lib/graph/* （图谱关系）
 *
 * 作用：
 * - 提供记忆的统一抽象接口
 * - 管理 MemoryRecord 的生命周期
 * - 协调存储、向量、图谱三层能力
 */