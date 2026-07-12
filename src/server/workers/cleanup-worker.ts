/**
 * 清理任务执行器
 *
 * 调用关系：
 * - 被调用：server/schedulers/cleanup-scheduler.ts
 * - 调用：lib/storage/* （文件管理）
 *
 * 作用：
 * - 执行定期清理任务
 * - 清理过期记忆、失败记录、临时文件
 * - 维护 archive/* 目录的归档管理
 */