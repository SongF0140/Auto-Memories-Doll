import { streamText, smoothStream, tool, isStepCount, jsonSchema } from "ai";
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
 * MCP 等外部工具只有普通 JSON Schema 对象；AI SDK 只接受 Schema 实例，
 * 未包装的普通对象会在 SDK prepare-tools 转换中崩溃。Zod/Schema 实例原样传递。
 */
export function toSdkInputSchema(parameters: unknown): unknown {
  if (
    parameters !== null &&
    typeof parameters === "object" &&
    !("~standard" in (parameters as Record<string, unknown>))
  ) {
    return jsonSchema(parameters as Parameters<typeof jsonSchema>[0]);
  }
  return parameters;
}

function isNormalizedEnvelope(
  output: unknown,
): output is { success?: unknown; content?: unknown; error?: unknown } {
  return typeof output === "object" && output !== null && "success" in output;
}

/** toSdkTool 产出的 SDK 工具结构（收窄类型供测试与调用方直接断言 toModelOutput） */
export interface SdkTool {
  description?: string;
  inputSchema: unknown;
  execute?: (input: Record<string, unknown>) => Promise<unknown>;
  toModelOutput: (options: { toolCallId: string; input: unknown; output: unknown }) => {
    type: "text" | "error-text" | "json";
    value: unknown;
  };
}

/**
 * 将 AiToolDef 转为 SDK tool：模型只消费文本 content（信封 success 映射
 * text/error-text），UI/日志侧结构化 data 由 tool_call_result 事件承载。
 */
export function toSdkTool(def: AiToolDef): SdkTool {
  return tool({
    description: def.description,
    inputSchema: toSdkInputSchema(def.parameters),
    ...(def.execute ? { execute: def.execute } : {}),
    toModelOutput: ({ output }: { output: unknown }) => {
      if (typeof output === "string") return { type: "text" as const, value: output };
      if (isNormalizedEnvelope(output)) {
        const failure = output.success === false;
        const value = failure
          ? String(output.error || output.content || "工具执行失败")
          : String(output.content ?? "");
        return { type: failure ? ("error-text" as const) : ("text" as const), value };
      }
      return { type: "json" as const, value: output ?? null };
    },
  } as any) as SdkTool;
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
    signal?: AbortSignal;
  }): ReadableStream<AiEvent> {
    const { messages, temperature, tools: toolDefs, readonly, modelType } = options;
    const tier = this.getTier(modelType);
    // AI SDK 7 将系统提示从 messages 移到 instructions。保留对上层
    // AiEvent / ChatMessage 契约的兼容，由 Provider 在边界处完成转换。
    const instructions = messages
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\n\n");
    const conversationMessages = messages.filter((message) => message.role !== "system");

    const cancellation = new AbortController();
    const abortSignal = options.signal
      ? AbortSignal.any([options.signal, cancellation.signal])
      : cancellation.signal;
    let reader: ReadableStreamDefaultReader<any> | undefined;
    let cancelled = false;
    let terminal = false;
    let hasToolErrors = false;
    const abort = () => {
      void reader?.cancel(abortSignal.reason).catch(() => undefined);
    };
    return new ReadableStream<AiEvent>({
      start: async (controller) => {
        try {
          if (abortSignal.aborted) {
            controller.enqueue({ type: "done", finishReason: "abort", status: "aborted" });
            return;
          }
          abortSignal.addEventListener("abort", abort, { once: true });
          const model = this.createModel(modelType);

          // 将 AiToolDef 转为 Vercel AI SDK 的 tool 对象
          // 统一走 toSdkTool：MCP 等普通 JSON Schema 经 toSdkInputSchema 包装，
          // 模型通道由 toModelOutput 承载（信封 success → text/error-text）
          const sdkTools: Record<string, any> = {};
          if (toolDefs && toolDefs.length > 0) {
            for (const t of toolDefs) {
              sdkTools[t.name] = toSdkTool(t);
            }
          }

          const result = streamText({
            model,
            abortSignal,
            instructions: instructions || undefined,
            messages: conversationMessages as any,
            temperature,
            // 必须将设置页中的额度传给提供商。DeepSeek 等推理模型会先输出
            // reasoning token，未设置额度时可能耗尽默认上限而没有最终文本。
            maxOutputTokens: tier.maxTokens,
            tools: toolDefs && toolDefs.length > 0 ? sdkTools : undefined,
            stopWhen: isStepCount(readonly ? 1 : 5),
            experimental_transform: smoothStream(),
          });

          // 使用 fullStream 获取所有事件（文本 + 工具调用）
          let roundNum = 0;
          reader = result.fullStream.getReader();
          // fullStream is a tee branch; drain the SDK-owned branch so cancel can settle.
          void result.consumeStream?.({ onError: () => undefined });
          while (!cancelled && !terminal && !abortSignal.aborted) {
            const { done, value: chunk } = await reader.read();
            if (done || cancelled || abortSignal.aborted) break;
            switch (chunk.type) {
              case "error":
                controller.enqueue({
                  type: "error",
                  message: chunk.error instanceof Error ? chunk.error.message : String(chunk.error),
                  status: "failed",
                });
                terminal = true;
                cancellation.abort(chunk.error);
                break;
              case "abort":
                controller.enqueue({ type: "done", finishReason: "abort", status: "aborted" });
                terminal = true;
                break;
              case "finish":
                controller.enqueue({
                  type: "done",
                  finishReason: chunk.finishReason,
                  status: ["error", "unknown"].includes(chunk.finishReason)
                    ? "failed"
                    : "completed",
                  ...(hasToolErrors ? { hasToolErrors: true } : {}),
                });
                terminal = true;
                break;
              case "tool-error": {
                hasToolErrors = true;
                const message =
                  chunk.error instanceof Error ? chunk.error.message : String(chunk.error);
                controller.enqueue({
                  type: "tool_call_result",
                  toolName: chunk.toolName,
                  callId: chunk.toolCallId,
                  result: message,
                  success: false,
                  error: message,
                });
                break;
              }
              case "text-delta":
                controller.enqueue({ type: "text_delta", content: chunk.text });
                break;
              case "tool-call": {
                controller.enqueue({
                  type: "tool_call_start",
                  toolName: chunk.toolName,
                  args: JSON.stringify(chunk.input),
                  callId: chunk.toolCallId,
                });
                break;
              }
              case "tool-result": {
                const output = chunk.output as Record<string, unknown> | string | undefined;
                const envelope =
                  output && typeof output === "object"
                    ? (output as Record<string, unknown>)
                    : undefined;
                const failure =
                  envelope !== undefined &&
                  (envelope.success === false || envelope.isError === true);
                if (failure) hasToolErrors = true;
                controller.enqueue({
                  type: "tool_call_result",
                  toolName: chunk.toolName,
                  callId: chunk.toolCallId,
                  success: !failure,
                  // 结构化 data 通道：仅信封输出透传，供 UI/日志侧消费
                  ...(envelope && envelope.data !== undefined ? { data: envelope.data } : {}),
                  ...(failure ? { error: String(envelope!.error || "Tool execution failed") } : {}),
                  result: typeof output === "string" ? output : JSON.stringify(output),
                });
                break;
              }
              case "start-step":
                if (roundNum > 0) {
                  controller.enqueue({ type: "round_start", round: roundNum });
                }
                roundNum++;
                break;
            }
          }

          if (!cancelled && !terminal) {
            controller.enqueue(
              abortSignal.aborted
                ? { type: "done", finishReason: "abort", status: "aborted" }
                : {
                    type: "error",
                    message: "SDK stream ended without a finish event",
                    status: "failed",
                  },
            );
          }
        } catch (error) {
          if (!cancelled && !terminal)
            controller.enqueue(
              abortSignal.aborted
                ? { type: "done", finishReason: "abort", status: "aborted" }
                : {
                    type: "error",
                    message: error instanceof Error ? error.message : String(error),
                    status: "failed",
                  },
            );
        } finally {
          abortSignal.removeEventListener("abort", abort);
          try {
            if (terminal) await reader?.cancel("terminal received");
          } finally {
            reader?.releaseLock();
          }
          if (!cancelled) controller.close();
        }
      },
      async cancel(reason) {
        cancelled = true;
        cancellation.abort(reason);
        await reader?.cancel(reason);
      },
    });
  }

  async generateEmbedding(text: string): Promise<number[]> {
    const tier = this.config.standard;
    const maxRetries = tier.maxRetries;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const openai = createOpenAI({
          // embedding 可配置专属凭证（如 GLM embedding + 主 key 走 Kimi chat）
          apiKey: this.config.embedding.apiKey || this.config.apiKey,
          baseURL: this.config.embedding.baseURL || this.config.baseURL,
        });
        const model = openai.embedding(this.config.embedding.model);
        const result = await model.doEmbed({ values: [text] });
        return result.embeddings[0] || [];
      } catch {
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
      // DeepSeek V4 enables thinking by default. The current chat event contract only
      // renders final text, so a short/default completion can otherwise end after
      // reasoning tokens with no text delta. Disable thinking until it is modeled as
      // a first-class UI event.
      ...(this.isDeepSeekEndpoint()
        ? {
            fetch: async (input, init) => {
              if (typeof init?.body !== "string") {
                return fetch(input, init);
              }

              try {
                const body = JSON.parse(init.body) as Record<string, unknown>;
                return fetch(input, {
                  ...init,
                  body: JSON.stringify({ ...body, thinking: { type: "disabled" } }),
                });
              } catch {
                return fetch(input, init);
              }
            },
          }
        : {}),
    });
    return openai.chat(tier.model);
  }

  private isDeepSeekEndpoint(): boolean {
    try {
      const hostname = new URL(this.config.baseURL).hostname;
      return hostname === "api.deepseek.com" || hostname.endsWith(".deepseek.com");
    } catch {
      return false;
    }
  }
}
