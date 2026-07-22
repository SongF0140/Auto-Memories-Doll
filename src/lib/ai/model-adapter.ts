import { generateText, embed } from "ai";
import { createLanguageModel, createEmbeddingModel } from "./provider";
import { getCurrentTime } from "../utils/date";
import { ConfigService } from "../../server/services/config-service";

export type ModelType = "mini" | "pro";

export type LlmResponse = {
  content: string;
  finishReason: string;
  model: string;
  timestamp: string;
};

export type EmbeddingResponse = {
  embedding: number[];
  model: string;
  timestamp: string;
};

function getConfig() {
  const service = new ConfigService();
  try {
    return service.getAiConfig() || service.getDefaultAiConfig();
  } finally {
    service.close();
  }
}

export class ModelAdapter {
  private static isDegraded = false;

  static get isDegradedMode(): boolean {
    return this.isDegraded;
  }

  static async generate(prompt: string, _modelType: ModelType): Promise<LlmResponse> {
    const config = getConfig();

    try {
      const model = createLanguageModel();
      const result = await generateText({
        model,
        messages: [{ role: "user", content: prompt }],
      });

      this.isDegraded = false;

      return {
        content: result.text,
        finishReason: result.finishReason || "unknown",
        model: config.chatModel,
        timestamp: getCurrentTime(),
      };
    } catch (error) {
      this.isDegraded = true;
      console.error("LLM API call failed:", error);

      return {
        content: this.getFallbackResponse(prompt),
        finishReason: "degraded",
        model: config.chatModel,
        timestamp: getCurrentTime(),
      };
    }
  }

  static async generateEmbedding(text: string): Promise<EmbeddingResponse> {
    const config = getConfig();

    try {
      const model = createEmbeddingModel();
      const result = await embed({
        model,
        value: text,
      });

      this.isDegraded = false;

      return {
        embedding: result.embedding,
        model: config.embeddingModel,
        timestamp: getCurrentTime(),
      };
    } catch (error) {
      this.isDegraded = true;
      console.error("Embedding API call failed:", error);

      return {
        embedding: [],
        model: config.embeddingModel,
        timestamp: getCurrentTime(),
      };
    }
  }

  private static getFallbackResponse(prompt: string): string {
    if (prompt.toLowerCase().includes("memory") || prompt.toLowerCase().includes("记忆")) {
      return "当前处于降级模式，我无法访问外部模型。您可以尝试查看本地记忆或检查 API 配置。";
    }
    return "当前处于降级模式，我无法生成智能回复。请检查 API 配置或网络连接。";
  }
}
