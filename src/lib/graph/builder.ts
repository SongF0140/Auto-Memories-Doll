/**
 * 关系构建器
 *
 * 调用关系：
 * - 被调用：lib/graph/manager.ts
 * - 调用：lib/ai/* （关系提取）
 *
 * 作用：
 * - 从记忆内容中提取关系边
 * - 生成 GraphEdge（from, to, relation, weight）
 * - 计算关系权重
 */