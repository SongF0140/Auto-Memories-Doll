/**
 * 待审计队列
 *
 * 调用关系：
 * - 被调用：features/memory/processor.ts
 * - 被调用：features/prompt/writer.ts
 * - 调用：features/audit/auditor.ts （触发审计流程）
 *
 * 作用：
 * - 管理待审计的任务队列
 * - 确保同一 memoryId 的事件按顺序串行处理，避免并发覆盖
 * - 提供任务的入队、出队、重试机制
 */