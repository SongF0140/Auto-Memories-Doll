/**
 * 记忆评分器
 *
 * 调用关系：
 * - 被调用：features/memory/processor.ts
 *
 * 作用：
 * - 计算记忆的热度分数（heatScore）
 * - 公式：heatScore = accessCount * 0.35 + recencyScore * 0.25 + exposureScore * 0.25 + tagAffinityScore * 0.15
 * - 归一化各项指标到 0-1 区间
 */