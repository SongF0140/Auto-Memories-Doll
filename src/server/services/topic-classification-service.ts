import { getAvailableTopics } from "../../config/topics.config";
import { ModelAdapter } from "../../lib/ai/model-adapter";
import { logger } from "../../lib/logger";

export type TopicClassificationInput = {
  title: string;
  summary: string;
  content: string;
  suggestedTopic: string;
};

export type TopicClassificationResult = {
  topic: string;
  confidence: number;
  source: "model" | "rules";
  reason?: string;
};

const LOW_CONFIDENCE_THRESHOLD = 0.45;
const PROMPT_CONTENT_LIMIT = 4_000;

export class TopicClassificationService {
  async classify(input: TopicClassificationInput): Promise<TopicClassificationResult> {
    const allowedTopics = this.getAllowedTopics();
    const fallbackTopic = allowedTopics.has(input.suggestedTopic)
      ? input.suggestedTopic
      : "uncategorized";

    if (ModelAdapter.isDegradedMode) {
      return this.ruleFallback(fallbackTopic, "模型降级，使用规则话题");
    }

    try {
      const response = await ModelAdapter.generate(
        this.buildPrompt(input, [...allowedTopics]),
        "standard",
      );
      const parsed = this.parseModelResponse(response.content);
      if (!parsed || !allowedTopics.has(parsed.topic)) {
        return this.ruleFallback(fallbackTopic, "模型输出话题不在白名单内");
      }

      const confidence = this.clampConfidence(parsed.confidence);
      if (confidence < LOW_CONFIDENCE_THRESHOLD) {
        return {
          topic: "uncategorized",
          confidence,
          source: "model",
          reason: parsed.reason || "模型置信度过低",
        };
      }

      return {
        topic: parsed.topic,
        confidence,
        source: "model",
        reason: parsed.reason,
      };
    } catch (error) {
      logger.ingest.warn("话题模型复核失败，回退规则分类", {
        suggestedTopic: fallbackTopic,
        error: (error as Error).message,
      });
      return this.ruleFallback(fallbackTopic, "模型调用失败，使用规则话题");
    }
  }

  private getAllowedTopics(): Set<string> {
    return new Set([...getAvailableTopics(), "uncategorized"]);
  }

  private ruleFallback(topic: string, reason: string): TopicClassificationResult {
    return { topic, confidence: 0.5, source: "rules", reason };
  }

  private buildPrompt(input: TopicClassificationInput, allowedTopics: string[]): string {
    return `你是知识库话题分类器。请只从白名单中选择最合适的话题目录，不要创造新目录。

白名单话题：
${allowedTopics.map((topic) => `- ${topic}`).join("\n")}

规则初判：${input.suggestedTopic}

记忆标题：
${input.title || "（无标题）"}

记忆摘要：
${input.summary || "（无摘要）"}

记忆正文片段：
${input.content.slice(0, PROMPT_CONTENT_LIMIT)}

返回严格 JSON，不要输出 markdown：
{"topic":"白名单中的话题","confidence":0到1之间的数字,"reason":"一句中文理由"}`;
  }

  private parseModelResponse(
    raw: string,
  ): { topic: string; confidence: number; reason?: string } | null {
    try {
      const cleaned = raw
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/```$/i, "")
        .trim();
      const parsed = JSON.parse(cleaned) as {
        topic?: unknown;
        confidence?: unknown;
        reason?: unknown;
      };
      if (typeof parsed.topic !== "string") return null;
      return {
        topic: parsed.topic.trim(),
        confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
        reason: typeof parsed.reason === "string" ? parsed.reason : undefined,
      };
    } catch {
      return null;
    }
  }

  private clampConfidence(confidence: number): number {
    if (!Number.isFinite(confidence)) return 0.5;
    return Math.max(0, Math.min(1, confidence));
  }
}
