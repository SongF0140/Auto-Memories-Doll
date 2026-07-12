/**
 * 审计入口 API 路由
 *
 * 调用关系：
 * - 接收：审计请求（从待审计队列）
 * - 调用：features/audit/* （审计、diff、冲突处理）
 * - 调用：server/schedulers/* （定时任务）
 * - 调用：server/workers/* （异步任务）
 * - 调用：lib/storage/* （本地存储与文件写回）
 *
 * 作用：
 * - 做离线规约
 * - 对比新旧记忆
 * - 解决冲突并生成可写回结果
 * - 统一负责本地文件写回、版本管理和失败重试
 * - 处理快轨与后台加工之间的不一致合并
 *
 * 约束：
 * - 写回顺序：先写 notes/*/note-*.md，再同步对应 notes/*/Agent.md，必要时更新 index-map.md 和 profile.md，最后写入 archive/* 快照
 * - 并发控制：同一 memoryId 的事件按顺序串行处理，避免并发覆盖
 * - 请求体 schema：需要定义
 * - 响应体 schema：需要定义
 * - 错误码表：需要定义
 */