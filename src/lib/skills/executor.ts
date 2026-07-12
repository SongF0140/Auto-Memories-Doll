/**
 * Skills 接入执行器
 *
 * 调用关系：
 * - 被调用：features/ingest/adapter.ts
 * - 调用：外部 Skills 服务
 *
 * 作用：
 * - 接入外部 Skills 调用
 * - 作为外部输入源，不直接绕过审计持久化层写入最终文件
 * - 提供统一的 Skills 接入接口
 */