/**
 * JSON 去重器
 *
 * 调用关系：
 * - 袂调用：server/pipelines/json-pipeline.ts
 *
 * 作用：
 * - 去除重复的 JSON 事件
 * - 基于事件 ID、内容哈希等判断重复
 * - 合并重复事件的元数据
 */