/**
 * 图谱管理器
 *
 * 调用关系：
 * - 被调用：features/memory/processor.ts
 * - 被调用：features/audit/auditor.ts
 * - 调用：lib/graph/builder.ts （关系构建）
 * - 调用：lib/graph/query.ts （关系查询）
 * - 调用：lib/storage/* （图谱持久化）
 *
 * 作用：
 * - 管理记忆关系图谱
 * - 维护 GraphEdge 关系边
 * - 支持关系的创建、更新、删除
 * - 协调图谱的持久化
 */