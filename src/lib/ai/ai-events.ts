/**
 * AiEvent — 统一的 AI 事件流
 * 所有 AI 提供商（OpenAI / Anthropic / 假实现）都输出相同的 AiEvent 流，
 * 前端和 Handler 不感知底层 SDK 差异。
 */
export type AiEvent =
  | { type: "thinking_start" }
  | { type: "thinking_delta"; content: string }
  | { type: "thinking_end" }
  | { type: "tool_call_start"; toolName: string; args: string; callId?: string }
  | {
      type: "tool_call_result";
      toolName: string;
      result: string;
      callId?: string;
      success?: boolean;
      error?: string;
      /** UI/日志侧结构化结果；模型只消费文本 content */
      data?: unknown;
    }
  | { type: "text_start" }
  | { type: "text_delta"; content: string }
  | { type: "text_end" }
  | { type: "round_start"; round: number }
  | { type: "done"; finishReason: string; status?: AiStreamStatus; hasToolErrors?: boolean }
  | { type: "error"; message: string; status?: AiStreamStatus };

export type AiStreamStatus = "completed" | "failed" | "aborted";

export function terminalStatus(event: AiEvent): AiStreamStatus | undefined {
  if (event.type === "error") return event.status || "failed";
  if (event.type !== "done") return undefined;
  return (
    event.status ||
    (event.finishReason === "abort"
      ? "aborted"
      : ["error", "degraded", "unknown"].includes(event.finishReason)
        ? "failed"
        : "completed")
  );
}

/**
 * ChatSessionEvent — 应用层会话事件，包装核心 AiEvent 并追加会话上下文。
 * 前端只消费 ChatSessionEvent，不直接消费 AiEvent。
 */
export type ChatSessionEvent = AiEvent & {
  sessionId: string;
  /** 本次请求命中的记忆引用 ID 列表 */
  memoryReferences?: string[];
  /** 当前工具调用轮次 */
  roundNum?: number;
};

/** 传递给 AI 提供商的工具定义 */
export type AiToolDef = {
  name: string;
  description: string;
  parameters: unknown;
  execute?: (args: Record<string, unknown>) => Promise<unknown>;
};

/**
 * AiProvider — 可替换的 AI 提供商接口
 * 所有实现（OpenAI / Anthropic / Fake）都通过 generateStream 输出统一的 AiEvent 流
 */
export interface AiProvider {
  /** 流式生成：将 messages 转为 AiEvent 流 */
  generateStream(options: {
    messages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
    temperature?: number;
    tools?: AiToolDef[];
    readonly?: boolean;
    signal?: AbortSignal;
  }): ReadableStream<AiEvent>;

  /** 文本嵌入：将文本转为向量 */
  generateEmbedding(text: string): Promise<number[]>;
}
