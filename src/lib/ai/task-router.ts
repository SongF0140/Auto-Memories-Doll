import type { ModelType } from "./model-adapter";

/**
 * 任务类别枚举 — 系统内各种 AI 调用场景。
 * 每个类别映射到不同模型层级，实现成本与质量的平衡。
 */
export type TaskCategory =
  // ── 旗舰任务：需要强推理能力 ──
  | "intent_classification" // 意图分类与路由分流
  | "audit_evaluation" // 审计评估、冲突裁决
  | "quality_evaluation" // 记忆质量评审
  | "final_evaluation" // 最终评估（如代码审查结论）
  // ── 普通任务：平衡质量与成本 ──
  | "chat_response" // 对话回复
  | "code_generation" // 代码生成
  | "profile_analysis" // 用户画像分析
  | "memory_extraction" // 记忆提取
  | "memory_classification" // 记忆分类
  | "translation" // 翻译
  // ── 廉价任务：低成本优先 ──
  | "test_generation" // 测试代码生成
  | "summarization" // 文本摘要
  | "simple_extraction" // 简单信息提取（标签、关键词等）
  | "format_conversion"; // 格式转换

/**
 * 任务路由器：按任务类别自动分配到对应模型层级。
 *
 * 分级策略：
 * - flagship：分流分析、评估审计 — 需要强推理，用旗舰模型（如 gpt-4o）
 * - standard： 对话回复、代码生成、画像分析 — 平衡质量与成本（如 gpt-4o-mini）
 * - budget：   测试生成、摘要、简单提取 — 低成本快速产出（如 gpt-3.5-turbo）
 *
 * 有机组合流水线：
 *   flagship 分类 → standard 生成 → budget 写测试 → flagship 最终评估
 */
export class TaskRouter {
  /** 任务类别 → 模型层级 映射表 */
  private static routing: Record<TaskCategory, ModelType> = {
    intent_classification: "flagship",
    audit_evaluation: "flagship",
    quality_evaluation: "flagship",
    final_evaluation: "flagship",
    chat_response: "standard",
    code_generation: "standard",
    profile_analysis: "standard",
    memory_extraction: "standard",
    memory_classification: "standard",
    translation: "standard",
    test_generation: "budget",
    summarization: "budget",
    simple_extraction: "budget",
    format_conversion: "budget",
  };

  /** 根据任务类别获取应使用的模型层级 */
  static route(category: TaskCategory): ModelType {
    return this.routing[category];
  }

  /** 获取所有路由映射（供调试/审计使用） */
  static getRoutingTable(): Readonly<Record<TaskCategory, ModelType>> {
    return this.routing;
  }

  /** 动态覆盖某个类别的路由（用于 A/B 测试或紧急切换） */
  static override(category: TaskCategory, slot: ModelType): void {
    this.routing[category] = slot;
  }
}
