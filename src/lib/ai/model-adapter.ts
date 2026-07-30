import { generateText, embed } from "ai";
import { createLanguageModel, createEmbeddingModel } from "./provider";
import { getCurrentTime } from "../utils/date";
import { ConfigService } from "../../server/services/config-service";
import { OpenAIProvider } from "./openai-provider";
import { AiProvider, AiEvent } from "./ai-events";

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

/** 获取当前可用的 AiProvider 实例 */
function getProvider(): AiProvider {
  const config = getConfig();
  // API Key 为空时这里仍返回 provider，降级逻辑在 generateStream 的 catch 中处理
  return new OpenAIProvider(config);
}

export class ModelAdapter {
  private static isDegraded = false;

  static get isDegradedMode(): boolean {
    return this.isDegraded;
  }

  // ── 核心新接口：统一的事件流 ──

  /**
   * 流式生成，返回统一的 AiEvent 流
   * 前端和 Handler 只消费 AiEvent，不感知底层 SDK
   */
  static generateStream(options: {
    messages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
    temperature?: number;
    tools?: import("./ai-events").AiToolDef[];
    readonly?: boolean;
  }): ReadableStream<AiEvent> {
    const config = getConfig();

    // 未配置 API Key 时返回降级流
    if (!config.apiKey || config.apiKey.trim() === "") {
      return this.createFallbackStream("当前处于离线模式，请前往设置页面配置 AI API Key 和 baseURL。");
    }

    try {
      const provider = getProvider();
      return provider.generateStream(options);
    } catch {
      return this.createFallbackStream("当前处于离线模式，请检查 AI 配置。");
    }
  }

  private static createFallbackStream(message: string): ReadableStream<AiEvent> {
    return new ReadableStream<AiEvent>({
      start(controller) {
        controller.enqueue({ type: "text_start" });
        controller.enqueue({ type: "text_delta", content: message });
        controller.enqueue({ type: "text_end" });
        controller.enqueue({ type: "done", finishReason: "error" });
        controller.close();
      },
    });
  }

  // ── 以下为向后兼容的旧接口 ──

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

    if (!config.apiKey || config.apiKey.trim() === "") {
      console.warn("[ModelAdapter] 未配置 API Key，跳过向量生成");
      return {
        embedding: [],
        model: config.embeddingModel,
        timestamp: getCurrentTime(),
      };
    }

    try {
      const provider = getProvider();
      const embedding = await provider.generateEmbedding(text);

      this.isDegraded = false;
      return {
        embedding,
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
      return "当前处于离线模式，无法连接 AI 服务。你可以查看本地已保存的记忆，或前往设置页面检查 API 配置是否正确。";
    }
    return "当前处于离线模式，无法生成智能回复。请检查 AI API 配置是否正确（设置 > AI 配置），确保 baseURL 和 API Key 已填写。";
  }
}
