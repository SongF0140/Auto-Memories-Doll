/**
 * 记忆服务
 *
 * 调用关系：
 * - 被调用：server/services/orchestrator.ts
 * - 调用：features/memory/* （记忆处理）
 * - 调用：lib/storage/* （本地存储）
 * - 调用：lib/vector/* （向量索引）
 * - 调用：lib/graph/* （图谱关系）
 *
 * 作用：
 * - 提供记忆相关的业务服务
 * - 协调记忆的创建、检索、更新、删除
 * - 管理记忆的生命周期
 */