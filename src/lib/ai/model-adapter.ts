import { ConfigService } from "../../server/services/config-service";
import { getCurrentTime } from "../utils/date";

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

export class ModelAdapter {
  private static isDegraded = false;
  private static lastFailureTime = 0;

  static get isDegradedMode(): boolean {
    return this.isDegraded;
  }

  private static getConfig() {
    const service = new ConfigService();
    try {
      return service.getAiConfig() || service.getDefaultAiConfig();
    } finally {
      service.close();
    }
  }

  static async generate(prompt: string, _modelType: ModelType): Promise<LlmResponse> {
    const config = this.getConfig();

    try {
      const response = await fetch(`${config.baseURL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.chatModel,
          messages: [{ role: "user", content: prompt }],
          max_tokens: config.maxTokens,
          temperature: config.temperature,
          stream: false,
        }),
        signal: AbortSignal.timeout(config.timeout),
      });

      if (!response.ok) {
        throw new Error(`API request failed: ${response.status}`);
      }

      const data = await response.json();
      this.isDegraded = false;

      return {
        content: data.choices?.[0]?.message?.content || data.choices?.[0]?.text || "",
        finishReason: data.choices?.[0]?.finish_reason || "unknown",
        model: config.chatModel,
        timestamp: getCurrentTime(),
      };
    } catch (error) {
      this.isDegraded = true;
      this.lastFailureTime = Date.now();
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
    const config = this.getConfig();

    try {
      const response = await fetch(`${config.baseURL}/embeddings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.embeddingModel,
          input: text,
        }),
        signal: AbortSignal.timeout(config.timeout),
      });

      if (!response.ok) {
        throw new Error(`Embedding API request failed: ${response.status}`);
      }

      const data = await response.json();
      this.isDegraded = false;

      return {
        embedding: data.data?.[0]?.embedding || [],
        model: config.embeddingModel,
        timestamp: getCurrentTime(),
      };
    } catch (error) {
      this.isDegraded = true;
      this.lastFailureTime = Date.now();
      console.error("Embedding API call failed:", error);

      return {
        embedding: Array(config.embeddingDimensions).fill(0),
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
