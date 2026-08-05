import { MemoryRecord } from "../../types/memory";
import { ModelAdapter } from "../../lib/ai/model-adapter";
import { logger } from "../../lib/logger";

export type QualityFilterResult = {
  ok: boolean;
  reason?: string;
};

/**
 * 入站记忆质量过滤器。
 *
 * 使用旗舰 LLM 对候选记忆进行语义级质量判断：
 * - 过滤空泛、重复、广告、无意义片段
 * - API 不可用时自动放行，避免阻塞写入
 */
export class QualityFilterService {
  async filter(candidate: MemoryRecord): Promise<QualityFilterResult> {
    if (ModelAdapter.isDegradedMode) {
      return { ok: true };
    }

    const prompt = this.buildPrompt(candidate);

    try {
      const response = await ModelAdapter.generate(prompt, "flagship");
      const text = response.content.trim().toUpperCase();

      if (text.startsWith("PASS")) {
        return { ok: true };
      }

      if (text.startsWith("FAIL")) {
        const reason = response.content.replace(/^FAIL\s*[:：]?\s*/i, "").trim() || "质量未达标";
        return { ok: false, reason };
      }

      // 非标准输出时放行，避免误杀
      return { ok: true };
    } catch (error) {
      logger.quality.warn("质量过滤调用失败，放行记忆", { error: (error as Error).message });
      return { ok: true };
    }
  }

  private buildPrompt(candidate: MemoryRecord): string {
    return `你是一道记忆入库质量闸门。请判断以下内容是否值得作为长期记忆保存。

标题：${candidate.title}
摘要：${candidate.summary}
内容：${candidate.content.slice(0, 2000)}

规则：
- 如果是空泛、重复、广告、无意义片段或过度碎片化的内容，回复：FAIL: <原因>
- 如果包含有价值的事实、决策、知识或经历，回复：PASS

只回复 PASS 或 FAIL: <原因>，不要多余解释。`;
  }
}
