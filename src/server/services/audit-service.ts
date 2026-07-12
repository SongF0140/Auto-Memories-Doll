/**
 * 审计服务
 *
 * 调用关系：
 * - 被调用：server/services/orchestrator.ts
 * - 调用：features/audit/* （审计处理）
 * - 调用：server/workers/* （异步任务）
 *
 * 作用：
 * - 提供审计相关的业务服务
 * - 协调审计流程的执行
 * - 管理审计队列和任务调度
 */