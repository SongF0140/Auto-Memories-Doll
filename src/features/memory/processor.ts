/**
 * 记忆处理器
 *
 * 调用关系：
 * - 被调用：app/api/memory/route.ts
 * - 被调用：server/pipelines/* （后台加工流水线）
 * - 调用：features/memory/classifier.ts （记忆分类）
 * - 调用：features/memory/scorer.ts （记忆评分）
 * - 调用：features/memory/extractor.ts （记忆提取）
 *
 * 作用：
 * - 处理记忆的创建、更新、删除
 * - 调用分类、评分、提取逻辑
 * - 生成候选记忆和标签索引
 * - 将结果写入待审计队列
 */