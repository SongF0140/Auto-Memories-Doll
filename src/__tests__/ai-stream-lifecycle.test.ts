import { beforeEach, describe, expect, it, vi } from "vitest";
import { OpenAIProvider } from "../lib/ai/openai-provider";
import { aiEventStreamToResponse, wrapAiStream } from "../lib/ai/stream-adapter";
import type { AiEvent } from "../lib/ai/ai-events";
import type { AiConfig } from "../types/config";

const sdk = vi.hoisted(() => ({ streamText: vi.fn() }));
vi.mock("ai", () => ({
  streamText: sdk.streamText,
  smoothStream: vi.fn(),
  tool: (value: unknown) => value,
  isStepCount: vi.fn(),
  jsonSchema: (schema: unknown) => ({ jsonSchema: schema }),
}));
vi.mock("@ai-sdk/openai", () => ({ createOpenAI: () => ({ chat: () => ({}) }) }));
vi.mock("@ai-sdk/anthropic", () => ({ createAnthropic: () => () => ({}) }));
const tier = { model: "mock", maxTokens: 100, temperature: 0.7, timeout: 1000, maxRetries: 0 };
const config = {
  provider: "openai-compatible",
  apiKey: "mock",
  baseURL: "https://example.invalid",
  standard: tier,
  budget: tier,
  flagship: tier,
} as AiConfig;
async function drain(stream: ReadableStream<AiEvent>) {
  const reader = stream.getReader();
  const events: AiEvent[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return events;
      events.push(value);
    }
  } finally {
    reader.releaseLock();
  }
}
function chunks(values: unknown[]) {
  return new ReadableStream({
    start(controller) {
      values.forEach((value) => controller.enqueue(value));
      controller.close();
    },
  });
}
describe("AI stream lifecycle", () => {
  // 注意：必须用块体避免隐式返回 mock 本身——vitest 会把 beforeEach 返回值
  // 当 cleanup 函数在测试结束后无参调用，导致 mockImplementation 用例报错
  beforeEach(() => {
    sdk.streamText.mockReset();
  });
  it("maps SDK error and suppresses later success", async () => {
    const source = chunks([
      { type: "error", error: new Error("sdk failed") },
      { type: "finish", finishReason: "stop" },
    ]);
    sdk.streamText.mockReturnValue({ fullStream: source, finishReason: Promise.resolve("stop") });
    expect(await drain(new OpenAIProvider(config).generateStream({ messages: [] }))).toEqual([
      { type: "error", message: "sdk failed", status: "failed" },
    ]);
    expect(source.locked).toBe(false);
  });
  it("preserves recoverable tool errors and call ids without failing the round", async () => {
    sdk.streamText.mockReturnValue({
      fullStream: chunks([
        { type: "tool-call", toolName: "lookup", toolCallId: "c1", input: {} },
        { type: "tool-error", toolName: "lookup", toolCallId: "c1", error: new Error("missing") },
        { type: "text-delta", text: "recovered" },
        { type: "finish", finishReason: "stop" },
      ]),
      finishReason: Promise.resolve("stop"),
    });
    const events = await drain(new OpenAIProvider(config).generateStream({ messages: [] }));
    expect(events[0]).toMatchObject({ type: "tool_call_start", callId: "c1" });
    expect(events[1]).toMatchObject({
      type: "tool_call_result",
      callId: "c1",
      success: false,
      error: "missing",
    });
    expect(events.at(-1)).toMatchObject({ type: "done", status: "completed", hasToolErrors: true });
    expect(events.some((event) => event.type === "error")).toBe(false);
  });
  it("maps SDK abort without awaiting an unresolved finishReason", async () => {
    sdk.streamText.mockReturnValue({
      fullStream: chunks([{ type: "abort", reason: "cancelled" }]),
      finishReason: new Promise(() => undefined),
    });
    expect(await drain(new OpenAIProvider(config).generateStream({ messages: [] }))).toEqual([
      { type: "done", finishReason: "abort", status: "aborted" },
    ]);
  });
  it("maps thrown stream errors and releases the SDK reader", async () => {
    const source = new ReadableStream({
      pull(controller) {
        controller.error(new Error("read failed"));
      },
    });
    sdk.streamText.mockReturnValue({ fullStream: source, finishReason: Promise.resolve("stop") });
    expect(await drain(new OpenAIProvider(config).generateStream({ messages: [] }))).toEqual([
      { type: "error", message: "read failed", status: "failed" },
    ]);
    expect(source.locked).toBe(false);
  });
  it("propagates cancellation to SDK signal and reader", async () => {
    const cancel = vi.fn();
    const source = new ReadableStream({
      start(controller) {
        controller.enqueue({ type: "text-delta", text: "partial" });
      },
      cancel,
    });
    sdk.streamText.mockReturnValue({ fullStream: source, finishReason: Promise.resolve("stop") });
    const request = new AbortController();
    const stream = new OpenAIProvider(config).generateStream({
      messages: [],
      signal: request.signal,
    } as Parameters<OpenAIProvider["generateStream"]>[0]);
    const reader = stream.getReader();
    await reader.read();
    await reader.cancel("client closed");
    expect(sdk.streamText.mock.calls[0][0].abortSignal.aborted).toBe(true);
    expect(cancel).toHaveBeenCalledWith("client closed");
    expect(source.locked).toBe(false);
  });
  it("request abort wakes pending reads and pre-abort does not call SDK", async () => {
    const request = new AbortController();
    const source = new ReadableStream({
      start(controller) {
        controller.enqueue({ type: "text-delta", text: "partial" });
      },
    });
    sdk.streamText.mockReturnValue({ fullStream: source });
    const reader = new OpenAIProvider(config)
      .generateStream({ messages: [], signal: request.signal })
      .getReader();
    await reader.read();
    request.abort("stop");
    expect((await reader.read()).value).toMatchObject({ type: "done", status: "aborted" });
    expect((await reader.read()).done).toBe(true);
    expect(source.locked).toBe(false);
    sdk.streamText.mockClear();
    expect(
      await drain(
        new OpenAIProvider(config).generateStream({ messages: [], signal: request.signal }),
      ),
    ).toEqual([{ type: "done", finishReason: "abort", status: "aborted" }]);
    expect(sdk.streamText).not.toHaveBeenCalled();
  });
  it("SSE cancellation cancels and unlocks its source", async () => {
    const cancel = vi.fn();
    const source = new ReadableStream<AiEvent>({
      start(controller) {
        controller.enqueue({ type: "text_delta", content: "partial" });
      },
      cancel,
    });
    const reader = aiEventStreamToResponse(source).body!.getReader();
    await reader.read();
    await reader.cancel("disconnect");
    expect(cancel).toHaveBeenCalledWith("disconnect");
    expect(source.locked).toBe(false);
  });
  it("SSE emits only one terminal and releases its source", async () => {
    const source = chunks([
      { type: "error", message: "failed" },
      { type: "done", finishReason: "stop" },
    ]) as ReadableStream<AiEvent>;
    const text = await aiEventStreamToResponse(source).text();
    expect(text).toContain('"type":"error"');
    expect(text).not.toContain('"type":"done"');
    expect(source.locked).toBe(false);
  });

  it("preserves completion across nested cleanup cancellations", async () => {
    const source = chunks([
      { type: "text_delta", content: "synthetic answer" },
      { type: "done", finishReason: "stop", status: "completed" },
    ]) as ReadableStream<AiEvent>;
    const finalizers = [vi.fn(), vi.fn(), vi.fn()];
    const nested = finalizers.reduce(
      (stream, onFinalize) => wrapAiStream(() => stream, { onFinalize }),
      source,
    );

    const response = await aiEventStreamToResponse(nested).text();

    expect(response).toContain('"status":"completed"');
    expect(response.match(/"type":"done"/g)).toHaveLength(1);
    for (const finalize of finalizers) {
      expect(finalize).toHaveBeenCalledExactlyOnceWith(false);
    }
    expect(source.locked).toBe(false);
  });

  it("tool result 事件保留结构化 data 通道并按信封判定成败", async () => {
    sdk.streamText.mockReturnValue({
      fullStream: chunks([
        { type: "tool-call", toolName: "lookup", toolCallId: "c1", input: {} },
        {
          type: "tool-result",
          toolName: "lookup",
          toolCallId: "c1",
          output: { success: true, content: "ok", data: { id: "m1" } },
        },
        { type: "finish", finishReason: "stop" },
      ]),
      finishReason: Promise.resolve("stop"),
    });
    const events = await drain(new OpenAIProvider(config).generateStream({ messages: [] }));
    expect(events[1]).toMatchObject({
      type: "tool_call_result",
      callId: "c1",
      success: true,
      data: { id: "m1" },
    });
    expect(events.at(-1)).toMatchObject({ type: "done", status: "completed" });
    expect(events.at(-1)).not.toHaveProperty("hasToolErrors");
  });

  it("tool result 事件透传 MCP isError 原始对象为失败", async () => {
    sdk.streamText.mockReturnValue({
      fullStream: chunks([
        { type: "tool-call", toolName: "remote", toolCallId: "c2", input: {} },
        {
          type: "tool-result",
          toolName: "remote",
          toolCallId: "c2",
          output: { isError: true, content: [{ type: "text", text: "远端失败" }] },
        },
        { type: "finish", finishReason: "stop" },
      ]),
      finishReason: Promise.resolve("stop"),
    });
    const events = await drain(new OpenAIProvider(config).generateStream({ messages: [] }));
    expect(events[1]).toMatchObject({
      type: "tool_call_result",
      callId: "c2",
      success: false,
    });
    expect(events.at(-1)).toMatchObject({ type: "done", status: "completed", hasToolErrors: true });
  });

  it("MCP 普通 JSON Schema 由 provider 包装后可构建 SDK 工具", async () => {
    let capturedTools: unknown;
    sdk.streamText.mockImplementation((options: { tools?: unknown }) => {
      capturedTools = options.tools;
      return { fullStream: chunks([{ type: "finish", finishReason: "stop" }]) };
    });
    await drain(
      new OpenAIProvider(config).generateStream({
        messages: [],
        tools: [
          {
            name: "mcp_tool",
            description: "d",
            parameters: { type: "object", properties: { q: { type: "string" } } },
            execute: async () => ({ success: true, content: "ok" }),
          },
        ],
      }),
    );
    expect(capturedTools).toMatchObject({
      mcp_tool: { description: "d", inputSchema: { jsonSchema: { type: "object" } } },
    });
  });
});
