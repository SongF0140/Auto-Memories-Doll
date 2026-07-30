import { AiEvent, AiProvider } from "./ai-events";

/**
 * FakeProvider — 确定性假实现，用于测试
 * 不调用任何外部 API，产出可预测的 AiEvent 流
 */
export class FakeProvider implements AiProvider {
  private responses: string[];
  private embeddings: Map<string, number[]>;

  constructor(options?: {
    responses?: string[];
    embeddings?: Record<string, number[]>;
  }) {
    this.responses = options?.responses || ["这是一个假回复。"];
    this.embeddings = new Map(Object.entries(options?.embeddings || {}));
  }

  generateStream(options: {
    messages: Array<{ role: string; content: string }>;
    temperature?: number;
    tools?: import("./ai-events").AiToolDef[];
    readonly?: boolean;
  }): ReadableStream<AiEvent> {
    const responseText = this.responses[0] || "假回复";
    const self = this;

    return new ReadableStream<AiEvent>({
      start(controller) {
        controller.enqueue({ type: "text_start" });
        controller.enqueue({ type: "text_delta", content: responseText });
        controller.enqueue({ type: "text_end" });
        controller.enqueue({ type: "done", finishReason: "stop" });
        controller.close();
      },
    });
  }

  async generateEmbedding(text: string): Promise<number[]> {
    // 简单的哈希式假嵌入：固定 128 维
    if (this.embeddings.has(text)) {
      return this.embeddings.get(text)!;
    }
    const embedding = Array.from({ length: 128 }, (_, i) =>
      (text.charCodeAt(i % text.length) / 255) * 2 - 1
    );
    this.embeddings.set(text, embedding);
    return embedding;
  }
}
