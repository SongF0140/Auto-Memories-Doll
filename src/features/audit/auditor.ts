/**
 * 审计处理器
 *
 * 调用关系：
 * - 被调用：app/api/audit/route.ts
 * - 调用：features/audit/differ.ts （差异比对）
 * - 调用：features/audit/conflict-resolver.ts （冲突处理）
 * - 调用：features/audit/version-manager.ts （版本管理）
 * - 调用：lib/storage/* （文件写回）
 *
 * 作用：
 * - 做离线规约
 * - 对比新旧记忆
 * - 解决冲突并生成可写回结果
 * - 统一负责本地文件写回、版本管理和失败重试
 */