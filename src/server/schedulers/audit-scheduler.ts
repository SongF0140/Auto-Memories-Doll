/**
 * 审计调度器
 *
 * 调用关系：
 * - 调用：server/workers/audit-worker.ts （审计任务）
 * - 调用：features/audit/queue.ts （待审计队列）
 *
 * 作用：
 * - 定期调度审计任务
 * - 管理审计队列的消费
 * - 处理任务的重试和失败恢复
 */