/**
 * 提示词写入器
 *
 * 调用关系：
 * - 被调用：features/prompt/manager.ts
 * - 调用：lib/storage/* （写入提示词文件）
 * - 调用：features/audit/queue.ts （写入待审计队列）
 *
 * 作用：
 * - 将提示词写入本地存储
 * - 更新 profile.md
 * - 触发审计流程（如需要）
 */