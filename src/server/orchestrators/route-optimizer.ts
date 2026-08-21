import { MemoryRecord } from "../../types/memory";
import { ModelAdapter } from "../../lib/ai/model-adapter";
import { TaskRouter, TaskCategory } from "../../lib/ai/task-router";
import type { ModelType } from "../../lib/ai/model-adapter";
import { logger } from "../../lib/logger";

export interface RouteSuggestion {
  taskCategory: TaskCategory;
  currentModel: ModelType;
  suggestedModel: ModelType;
  reason: string;
}

export interface RouteOptimizationReport {
  suggestions: RouteSuggestion[];
  appliedCount: number;
}

/**
 * 路由表优化器（旗舰模型驱动）。
 *
 * 分析当日记忆的主题分布和系统使用情况，
 * 由旗舰模型建议调整 TaskRouter 的任务→模型映射。
 *
 * 与 per-request 旗舰路由不同，这里是离线批量分析：
 * - 分析今天的记忆内容特征
 * - 旗舰模型判断各类任务应该用哪层模型
 * - 通过 TaskRouter.override() 应用到路由表
 * - 下次请求立即生效（0ms 延迟）
 */
export class RouteOptimizer {
  async optimize(
    todaysMemories: MemoryRecord[],
    allMemories: MemoryRecord[],
  ): Promise<RouteOptimizationReport> {
    if (todaysMemories.length === 0) {
      return { suggestions: [], appliedCount: 0 };
    }

    if (ModelAdapter.isDegradedMode) {
      logger.nightly.info("模型降级中，跳过路由表优化");
      return { suggestions: [], appliedCount: 0 };
    }

    // 汇总今日记忆的主题和复杂度特征
    const topicDistribution: Record<string, number> = {};
    const topics = todaysMemories.map((m) => m.topic);
    for (const t of topics) {
      topicDistribution[t] = (topicDistribution[t] || 0) + 1;
    }

    // 当前路由表
    const currentRouting = TaskRouter.getRoutingTable();
    const routingSummary = Object.entries(currentRouting)
      .map(([task, model]) => `- ${task}: ${model}`)
      .join("\n");

    const topicSummary = Object.entries(topicDistribution)
      .sort((a, b) => b[1] - a[1])
      .map(([topic, count]) => `- ${topic}: ${count} 条`)
      .join("\n");

    const memorySample = todaysMemories
      .slice(0, 5)
      .map((m) => `"${m.title}" (${m.topic}): ${m.summary}`)
      .join("\n");

    const prompt = `你是一个 AI 系统的任务路由器优化专家。以下是当前系统的路由表（任务→模型层级）和今日的用户记忆特征。

## 当前路由表
${routingSummary}

## 今日记忆主题分布
${topicSummary}

## 今日记忆样本
${memorySample}

模型层级说明：
- flagship: 最强推理（如 gpt-4o），适合审计评估、质量评审
- standard: 平衡质量与成本（如 gpt-4o-mini），适合对话、代码生成、记忆提取
- budget: 低成本快速（如 gpt-3.5-turbo），适合摘要、简单提取、格式转换

## 任务类别
- intent_classification: 意图分类
- audit_evaluation: 审计评估
- quality_evaluation: 质量评审
- final_evaluation: 最终评估
- chat_response: 对话回复
- code_generation: 代码生成
- profile_analysis: 画像分析
- memory_extraction: 记忆提取
- memory_classification: 记忆分类
- translation: 翻译
- test_generation: 测试生成
- summarization: 摘要
- simple_extraction: 简单提取
- format_conversion: 格式转换

根据今日记忆的主题和复杂度，分析哪些任务的路由需要调整。返回 JSON 数组，每项格式：
{
  "taskCategory": "任务类别名",
  "currentModel": "当前模型层级",
  "suggestedModel": "建议模型层级",
  "reason": "调整理由（中文，一句话）"
}

规则：
- 只返回需要调整的任务（不需要调整的不要返回）
- 如果当前路由合理，返回空数组 []
- 不要随意降级（把 flagship 降成 budget 需要充分理由）

只返回 JSON 数组，不要其他文字。`;

    try {
      const response = await ModelAdapter.generate(prompt, "flagship");
      const jsonStr = response.content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");

      const analyzed = JSON.parse(jsonStr);
      if (!Array.isArray(analyzed) || analyzed.length === 0) {
        return { suggestions: [], appliedCount: 0 };
      }

      const validModels = new Set(["flagship", "standard", "budget"]);
      const validTasks = new Set(Object.keys(currentRouting));
      const suggestions: RouteSuggestion[] = [];

      for (const item of analyzed) {
        if (!validTasks.has(item.taskCategory)) continue;
        if (!validModels.has(item.suggestedModel)) continue;
        if (item.currentModel === item.suggestedModel) continue;

        suggestions.push({
          taskCategory: item.taskCategory as TaskCategory,
          currentModel: (item.currentModel || currentRouting[item.taskCategory as TaskCategory]) as ModelType,
          suggestedModel: item.suggestedModel as ModelType,
          reason: item.reason || "旗舰模型建议调整",
        });
      }

      // 应用建议
      let appliedCount = 0;
      for (const s of suggestions) {
        try {
          TaskRouter.override(s.taskCategory, s.suggestedModel);
          logger.nightly.info("路由表已更新", {
            task: s.taskCategory,
            from: s.currentModel,
            to: s.suggestedModel,
          });
          appliedCount++;
        } catch (e) {
          logger.nightly.warn("路由覆写失败", { task: s.taskCategory, error: (e as Error).message });
        }
      }

      return { suggestions, appliedCount };
    } catch {
      return { suggestions: [], appliedCount: 0 };
    }
  }

  close(): void {}
}
