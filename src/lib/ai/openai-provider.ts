import { streamText, smoothStream, tool, isStepCount } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { AiEvent, AiProvider, AiToolDef } from "./ai-events";
import { AiConfig, ModelTierConfig } from "../../types/config";
import type { ModelType } from "./model-adapter";

/** 指数退避等待 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * OpenAIProvider — 封装 Vercel AI SDK 的 OpenAI/Anthropic 实现
 * 内部使用 ai-sdk 做实际调用，对外输出统一的 AiEvent 流
 */
export class OpenAIProvider implements AiProvider {
  private config: AiConfig;

  constructor(config: AiConfig) {
    this.config = config;
  }

  generateStream(options: {
    messages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
    temperature?: number;
    tools?: AiToolDef[];
    readonly?: boolean;
    modelType?: ModelType;
  }): ReadableStream<AiEvent> {
    const { messages, temperature, tools: toolDefs, readonly, modelType } = options;

    return new ReadableStream<AiEvent>({
      start: async (controller) => {
        try {
          const model = this.createModel(modelType);

          // 将 AiToolDef 转为 Vercel AI SDK 的 tool 对象
          const sdkTools: Record<string, any> = {};
          if (toolDefs && toolDefs.length > 0) {
            for (const t of toolDefs) {
              sdkTools[t.name] = tool({
                description: t.description,
                inputSchema: t.parameters,
                ...(t.execute ? { execute: t.execute } : {}),
              } as any);
            }
          }

          const result = streamText({
            model,
            messages: messages as any,
            temperature,
            tools: toolDefs && toolDefs.length > 0 ? sdkTools : undefined,
            stopWhen: isStepCount(readonly ? 1 : 5),
            experimental_transform: smoothStream(),
          });

          // 使用 fullStream 获取所有事件（文本 + 工具调用）
          let roundNum = 0;
          let currentToolName = "";

          for await (const chunk of result.fullStream) {
            switch (chunk.type) {
              case "text-delta":
                controller.enqueue({ type: "text_delta", content: chunk.text });
                break;
              case "tool-call": {
                currentToolName = chunk.toolName;
                controller.enqueue({
                  type: "tool_call_start",
                  toolName: chunk.toolName,
                  args: JSON.stringify(chunk.input),
                });
                break;
              }
              case "tool-result":
                controller.enqueue({
                  type: "tool_call_result",
                  toolName: chunk.toolName,
                  result: typeof chunk.output === "string" ? chunk.output : JSON.stringify(chunk.output),
                });
                break;
              case "start-step":
                if (roundNum > 0) {
                  controller.enqueue({ type: "round_start", round: roundNum });
                }
                roundNum++;
                break;
            }
          }

          const finishResult = await result.finishReason;
          controller.enqueue({
            type: "done",
            finishReason: finishResult || "stop",
          });
          controller.close();
        } catch (error) {
          controller.enqueue({
            type: "error",
            message: (error as Error).message || "Unknown error",
          });
          controller.close();
        }
      },
    });
  }

  async generateEmbedding(text: string): Promise<number[]> {
    const tier = this.config.standard;
    const maxRetries = tier.maxRetries;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const openai = createOpenAI({
          apiKey: this.config.apiKey,
          baseURL: this.config.baseURL,
        });
        const model = openai.embedding(this.config.embedding.model);
        const result = await model.doEmbed({ values: [text] });
        return result.embeddings[0] || [];
      } catch (error) {
        if (attempt === maxRetries) {
          return [];
        }
        await delay(Math.pow(2, attempt) * 1000);
      }
    }

    return [];
  }

  /** 根据 ModelType 解析对应 tier 配置 */
  private getTier(modelType?: ModelType): ModelTierConfig {
    const tier = modelType || "standard";
    return this.config[tier];
  }

  private createModel(modelType?: ModelType) {
    const tier = this.getTier(modelType);

    if (this.config.provider === "anthropic") {
      const anthropic = createAnthropic({
        apiKey: this.config.apiKey,
        baseURL: this.config.baseURL,
      });
      return anthropic(tier.model);
    }

    const openai = createOpenAI({
      apiKey: this.config.apiKey,
      baseURL: this.config.baseURL,
    });
    return openai(tier.model);
  }
}
