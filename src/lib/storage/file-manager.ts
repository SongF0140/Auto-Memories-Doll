/**
 * 文件管理器
 *
 * 调用关系：
 * - 被调用：features/prompt/writer.ts
 * - 被调用：features/audit/auditor.ts
 * - 被调用：lib/memory/abstract.ts
 * - 被调用：lib/vector/index.ts
 * - 被调用：lib/graph/manager.ts
 * - 调用：Node.js 文件系统 API
 *
 * 作用：
 * - 负责读写 notes/*、index-map.md、profile.md 和 archive/*
 * - 管理文件路径组织和版本落盘
 * - 提供统一的文件读写接口
 * - 处理并发控制（单写入队列或文件锁）
 */