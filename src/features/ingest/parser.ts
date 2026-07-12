/**
 * 数据解析器
 *
 * 调用关系：
 * - 被调用：features/ingest/adapter.ts
 * - 调用：features/ingest/validator.ts （数据校验）
 *
 * 作用：
 * - 解析不同格式的输入数据（JSON、事件流、文件落盘）
 * - 提取关键字段和元数据
 * - 处理数据格式转换
 */