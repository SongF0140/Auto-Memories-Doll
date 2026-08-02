import { generateText, embed } from "ai";
import { createLanguageModel, createEmbeddingModel } from "./provider";
import { getCurrentTime } from "../utils/date";
import { ConfigService } from "../../server/services/config-service";
import { OpenAIProvider } from "./openai-provider";
import { AiProvider, AiEvent } from "./ai-events";
import { logger } from "../logger";
import { apiConfig } from "../../config/api.config";

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

function getProvider(): AiProvider {
  const config = getConfig();
  return new OpenAIProvider(config);
}

export class ModelAdapter {
  private static isDegraded = false;
  private static healthCheckTimer: ReturnType<typeof setInterval> | null = null;

  static get isDegradedMode(): boolean {
    return this.isDegraded;
  }

  /** 启动健康检查：周期性测试 API 连通性，恢复后自动解除降级 */
  static startHealthCheck(): void {
    if (this.healthCheckTimer) return; // 已启动
    this.healthCheckTimer = setInterval(async () => {
      const config = getConfig();
      if (!config.apiKey) return;
      try {
        const provider = getProvider();
        await provider.generateEmbedding("health-check");
        if (this.isDegraded) {
          this.isDegraded = false;
          logger.api.info("AI API 已恢复，退出降级模式");
        }
      } catch {
        // 仍不可用，保持降级
      }
    }, apiConfig.degradation.checkInterval);
  }

  static stopHealthCheck(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  // ── 核心新接口：统一的事件流 ──

  static generateStream(options: {
    messages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
    temperature?: number;
    tools?: import("./ai-events").AiToolDef[];
    readonly?: boolean;
    modelType?: ModelType;
  }): ReadableStream<AiEvent> {
    const config = getConfig();

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

  static async generate(prompt: string, modelType: ModelType): Promise<LlmResponse> {
    const config = getConfig();

    try {
      const model = createLanguageModel(modelType);
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
      logger.api.error("LLM API 调用失败", { error: (error as Error).message });

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
      logger.vector.warn("未配置 API Key，跳过向量生成");
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
      logger.vector.error("Embedding API 调用失败", { error: (error as Error).message });

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
