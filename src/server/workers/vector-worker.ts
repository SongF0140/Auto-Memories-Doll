/**
 * 向量重建任务执行器
 *
 * 调用关系：
 * - 被调用：server/schedulers/vector-scheduler.ts
 * - 调用：lib/vector/* （向量生成和索引）
 *
 * 作用：
 * - 执行向量索引重建任务
 * - 处理批量向量生成和索引更新
 * - 管理向量同步和一致性
 */