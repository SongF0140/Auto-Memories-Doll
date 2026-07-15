import { apiConfig } from "../../config/api.config";
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

  static async generate(prompt: string, modelType: ModelType): Promise<LlmResponse> {
    const model = modelType === "mini" ? apiConfig.miniLlmModel : apiConfig.proLlmModel;
    
    try {
      const response = await fetch(`${apiConfig.baseURL}/v1/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiConfig.apiKey}`,
        },
        body: JSON.stringify({
          model,
          prompt,
          max_tokens: 2048,
          stream: false,
        }),
        signal: AbortSignal.timeout(apiConfig.timeout),
      });

      if (!response.ok) {
        throw new Error(`API request failed: ${response.status}`);
      }

      const data = await response.json();
      this.isDegraded = false;
      
      return {
        content: data.choices?.[0]?.text || "",
        finishReason: data.choices?.[0]?.finish_reason || "unknown",
        model,
        timestamp: getCurrentTime(),
      };
    } catch (error) {
      this.isDegraded = true;
      this.lastFailureTime = Date.now();
      console.error("LLM API call failed:", error);
      
      return {
        content: this.getFallbackResponse(prompt),
        finishReason: "degraded",
        model,
        timestamp: getCurrentTime(),
      };
    }
  }

  static async generateEmbedding(text: string): Promise<EmbeddingResponse> {
    try {
      const response = await fetch(`${apiConfig.baseURL}/v1/embeddings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiConfig.apiKey}`,
        },
        body: JSON.stringify({
          model: apiConfig.embedding.name,
          input: text,
        }),
        signal: AbortSignal.timeout(apiConfig.timeout),
      });

      if (!response.ok) {
        throw new Error(`Embedding API request failed: ${response.status}`);
      }

      const data = await response.json();
      this.isDegraded = false;
      
      return {
        embedding: data.data?.[0]?.embedding || [],
        model: apiConfig.embedding.name,
        timestamp: getCurrentTime(),
      };
    } catch (error) {
      this.isDegraded = true;
      this.lastFailureTime = Date.now();
      console.error("Embedding API call failed:", error);
      
      return {
        embedding: Array(apiConfig.embedding.dimensions).fill(0),
        model: apiConfig.embedding.name,
        timestamp: getCurrentTime(),
      };
    }
  }

  private static getFallbackResponse(prompt: string): string {
    if (prompt.toLowerCase().includes("memory") || prompt.toLowerCase().includes("记忆")) {
      return "当前处于降级模式，我无法访问外部模型。您可以尝试查看本地记忆或稍后再试。";
    }
    return "当前处于降级模式，我无法生成智能回复。请检查网络连接或稍后再试。";
  }
}