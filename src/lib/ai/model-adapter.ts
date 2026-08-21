import { generateText, embed } from "ai";
import { createLanguageModel, createEmbeddingModel } from "./provider";
import { getCurrentTime } from "../utils/date";
import { ConfigService } from "../../server/services/config-service";
import { OpenAIProvider } from "./openai-provider";
import { AiProvider, AiEvent } from "./ai-events";
import { logger } from "../logger";
import { apiConfig } from "../../config/api.config";
import { ModelPool, ConcurrencyTimeoutError } from "./model-pool";
import type { ModelSlot } from "../../types/config";

export type ModelType = "flagship" | "standard" | "budget";

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

  /** 全系统模型调用池 — 按层级限制并发，防止 API 请求风暴 */
  private static pool = new ModelPool(apiConfig.concurrency);

  static get isDegradedMode(): boolean {
    const config = getConfig();
    return this.isDegraded || !config.apiKey || config.apiKey.trim() === "";
  }

  /** 获取并发池统计信息 */
  static getPoolStats() {
    return this.pool.getStats();
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
    const slot: ModelSlot = options.modelType || "standard";

    if (!config.apiKey || config.apiKey.trim() === "") {
      return this.createFallbackStream(
        "当前处于离线模式，请前往设置页面配置 AI API Key 和 baseURL。",
      );
    }

    // 通过池化调度：流创建本身受并发限制，流消费不受限
    // 创建 ReadableStream 时异步获取槽位，超时则返回降级流
    return new ReadableStream<AiEvent>({
      start: async (controller) => {
        try {
          const provider = getProvider();
          const stream = await this.pool.execute(slot, () =>
            Promise.resolve(provider.generateStream(options)),
          );

          // 将池化后的流 pipe 到调用方的 controller
          const reader = stream.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(value);
          }
          controller.close();
        } catch (error) {
          if (error instanceof ConcurrencyTimeoutError) {
            const msg = `[${slot}] 模型并发已满 (${error.timeoutMs}ms 超时)，请稍后重试。`;
            controller.enqueue({ type: "text_start" } as any);
            controller.enqueue({ type: "text_delta", content: msg } as any);
            controller.enqueue({ type: "text_end" } as any);
            controller.enqueue({ type: "done", finishReason: "error" } as any);
          } else {
            controller.enqueue({ type: "error", message: (error as Error).message } as AiEvent);
          }
          controller.close();
        }
      },
    });
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
    const slot: ModelSlot = modelType;
    const tier = config[slot] || config.standard;

    try {
      const result = await this.pool.execute(slot, async () => {
        const model = createLanguageModel(modelType);
        return generateText({
          model,
          messages: [{ role: "user", content: prompt }],
        });
      });

      this.isDegraded = false;

      return {
        content: result.text,
        finishReason: result.finishReason || "unknown",
        model: tier.model,
        timestamp: getCurrentTime(),
      };
    } catch (error) {
      if (error instanceof ConcurrencyTimeoutError) {
        logger.api.warn(`[generate] ${slot} 并发超时`, { timeoutMs: error.timeoutMs });
        return {
          content: this.getFallbackResponse(prompt),
          finishReason: "degraded",
          model: tier.model,
          timestamp: getCurrentTime(),
        };
      }

      this.isDegraded = true;
      logger.api.error("LLM API 调用失败", { error: (error as Error).message });

      return {
        content: this.getFallbackResponse(prompt),
        finishReason: "degraded",
        model: tier.model,
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
        model: config.embedding.model,
        timestamp: getCurrentTime(),
      };
    }

    try {
      // embedding 使用独立的 embedding 池
      const embedding = await this.pool.execute("embedding", async () => {
        const provider = getProvider();
        return provider.generateEmbedding(text);
      });

      this.isDegraded = false;
      return {
        embedding,
        model: config.embedding.model,
        timestamp: getCurrentTime(),
      };
    } catch (error) {
      if (error instanceof ConcurrencyTimeoutError) {
        logger.vector.warn("[generateEmbedding] 并发超时");
        return {
          embedding: [],
          model: config.embedding.model,
          timestamp: getCurrentTime(),
        };
      }

      this.isDegraded = true;
      logger.vector.error("Embedding API 调用失败", { error: (error as Error).message });

      return {
        embedding: [],
        model: config.embedding.model,
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
