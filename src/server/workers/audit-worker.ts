/**
 * 审计任务执行器
 *
 * 调用关系：
 * - 被调用：server/services/audit-service.ts
 * - 调用：features/audit/* （审计处理）
 * - 调用：lib/storage/* （文件写回）
 *
 * 作用：
 * - 执行审计任务
 * - 处理差异比对、冲突解决、版本写回
 * - 管理任务的重试和失败恢复
 * - 记录失败上下文到 memory-root/archive/failures/
 */