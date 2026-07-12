/**
 * 清理调度器
 *
 * 调用关系：
 * - 调用：server/workers/cleanup-worker.ts （清理任务）
 *
 * 作用：
 * - 定期调度清理任务
 * - 管理 archive/* 目录的归档策略
 * - 维护系统的存储健康
 */