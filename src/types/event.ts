/**
 * 事件数据类型定义
 *
 * 调用关系：
 * - 袂引用：features/ingest/* （数据接入）
 * - 袂引用：server/pipelines/* （JSON 处理流水线）
 *
 * 作用：
 * - 定义标准化事件对象类型
 * - 定义事件来源类型（chat, ingest, manual, mcp, skill）
 * - 定义事件字段约束和校验
 */