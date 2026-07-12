/**
 * JSON 拆分器
 *
 * 调用关系：
 * - 被调用：server/pipelines/json-pipeline.ts
 *
 * 作用：
 * - 拆分复杂的 JSON 结构为单个事件
 * - 处理嵌套数据和数组
 * - 提取独立的事件单元
 */