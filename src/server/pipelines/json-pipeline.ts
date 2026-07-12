/**
 * JSON 处理流水线
 *
 * 调用关系：
 * - 被调用：app/api/ingest/route.ts
 * - 调用：server/pipelines/splitter.ts （拆分）
 * - 调用：server/pipelines/deduplicator.ts （去重）
 * - 调用：server/pipelines/formatter.ts （格式化）
 * - 调用：features/memory/* （记忆处理）
 *
 * 作用：
 * - 将多源输入整理为标准事件对象
 * - 执行 JSON 的拆分、去重、格式化
 * - 将处理结果传递给记忆处理模块
 */