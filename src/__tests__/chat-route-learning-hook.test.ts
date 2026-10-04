import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { AiEvent } from "../lib/ai/ai-events";

// env 固化：MEMORY_ROOT 透传 process.env（真实 ChatSessionService 写临时目录 JSONL）
vi.mock("../config/env", () => ({
  env: {
    NODE_ENV: "test",
    MODEL_API_KEY: "",
    MODEL_BASE_URL: "http://localhost:8080",
    MEMORY_ROOT: process.env.MEMORY_ROOT || "./memory-root",
    PORT: 3000,
    RERANK_MODEL: "Xenova/bge-reranker-base",
    RERANK_HF_ENDPOINT: "https://hf-mirror.com",
    RERANK_DISABLED: false,
  },
}));

// 学习服务 mock：记录入队调用（route 每次 POST new 一个实例，用共享实现收敛）
const enqueueCalls: Array<Record<string, unknown>> = [];
let enqueueShouldThrow = false;
const enqueueMock = vi.fn((input: Record<string, unknown>) => {
  if (enqueueShouldThrow) throw new Error("任务库不可用");
  enqueueCalls.push(input);
  return { enqueued: true };
});
const closeMock = vi.fn();

vi.mock("../server/services/conversation-learning-service", () => ({
  ConversationLearningService: vi.fn().mockImplementation(() => ({
    enqueueCompletedTurn: enqueueMock,
    close: closeMock,
  })),
}));

// dispatcher mock：按用例脚本返回 stream/json
const dispatchMock = vi.fn();
vi.mock("../features/agent/dispatcher", () => ({
  AgentDispatcher: vi.fn().mockImplementation(() => ({
    dispatch: dispatchMock,
    close: vi.fn(),
  })),
}));

import { POST as chatPOST } from "../app/api/chat/route";
import { POST as streamPOST } from "../app/api/chat/stream/route";

function eventStream(events: AiEvent[]): ReadableStream<AiEvent> {
  return new ReadableStream<AiEvent>({
    start(controller) {
      for (const e of events) controller.enqueue(e);
      controller.close();
    },
  });
}

function jsonRequest(path: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const baseBody = {
  messages: [{ role: "user", content: "今天学到了 watchEffect 立即执行一次" }],
  mode: "chat",
  sessionId: "hook-sess",
};

describe("聊天 route 统一调度与增量学习入队钩子", () => {
  beforeEach(() => {
    // 只清调用记录，不清 implementation（restoreAllMocks 会清掉模块级 mock 实现）
    vi.clearAllMocks();
    enqueueCalls.length = 0;
    enqueueShouldThrow = false;
  });

  it("stream route 使用与 chat route 相同的 AgentDispatcher 调度", async () => {
    dispatchMock.mockResolvedValue({
      type: "stream",
      stream: eventStream([
        { type: "text_start" },
        { type: "text_delta", content: "watchEffect 会立即执行。" },
        { type: "text_end" },
        { type: "done", finishReason: "stop" },
      ]),
    });

    const res = await streamPOST(jsonRequest("/api/chat/stream", baseBody));
    expect(res.status).toBe(200);
    await res.text();
    expect(dispatchMock).toHaveBeenCalledOnce();
  });

  it("stream route 成功完成的普通模式轮次入队一次（服务端 turnId）", async () => {
    dispatchMock.mockResolvedValue({
      type: "stream",
      stream: eventStream([
        { type: "text_delta", content: "watchEffect 会立即执行。" },
        { type: "done", finishReason: "stop" },
      ]),
    });

    const res = await streamPOST(jsonRequest("/api/chat/stream", baseBody));
    await res.text();

    expect(enqueueMock).toHaveBeenCalledOnce();
    const call = enqueueCalls[0];
    expect(call.mode).toBe("chat");
    expect(call.sessionId).toBe("hook-sess");
    expect(String(call.turnId)).toMatch(/^turn-/);
    expect(call.userText).toContain("watchEffect");
    expect(call.assistantText).toContain("立即执行");
  });

  it("失败/中止终态不入队", async () => {
    dispatchMock.mockResolvedValue({
      type: "stream",
      stream: eventStream([{ type: "error", message: "模型不可用", status: "failed" }]),
    });
    const failed = await streamPOST(jsonRequest("/api/chat/stream", baseBody));
    await failed.text();

    dispatchMock.mockResolvedValue({
      type: "stream",
      stream: eventStream([
        { type: "text_delta", content: "部分" },
        { type: "done", finishReason: "abort" },
      ]),
    });
    const aborted = await streamPOST(jsonRequest("/api/chat/stream", baseBody));
    await aborted.text();

    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("prompt 模式成功轮次不入队", async () => {
    dispatchMock.mockResolvedValue({
      type: "stream",
      stream: eventStream([
        { type: "text_delta", content: "改写完成" },
        { type: "done", finishReason: "stop" },
      ]),
    });
    const res = await streamPOST(jsonRequest("/api/chat/stream", { ...baseBody, mode: "prompt" }));
    await res.text();
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("入队失败不破坏聊天响应，也不伪造已保存", async () => {
    enqueueShouldThrow = true;
    dispatchMock.mockResolvedValue({
      type: "stream",
      stream: eventStream([
        { type: "text_delta", content: "正常回复" },
        { type: "done", finishReason: "stop" },
      ]),
    });

    const res = await streamPOST(jsonRequest("/api/chat/stream", baseBody));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("正常回复");
  });

  it("JSON 显式操作结果不作为学习轮次入队（两条 route 一致）", async () => {
    dispatchMock.mockResolvedValue({
      type: "json",
      data: { content: "已提交删除请求", memoryId: "mem-1" },
    });
    const chatRes = await chatPOST(jsonRequest("/api/chat", baseBody));
    expect(chatRes.status).toBe(200);
    expect(enqueueMock).not.toHaveBeenCalled();

    // stream route 把命令 JSON 包装为文本流供 SSE 客户端消费，但同样不入队
    const streamRes = await streamPOST(jsonRequest("/api/chat/stream", baseBody));
    expect(streamRes.status).toBe(200);
    const text = await streamRes.text();
    expect(text).toContain("已提交删除请求");
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("chat route 的流式分支同样通过统一钩子入队", async () => {
    dispatchMock.mockResolvedValue({
      type: "stream",
      stream: eventStream([
        { type: "text_delta", content: "普通回复" },
        { type: "done", finishReason: "stop" },
      ]),
    });
    const res = await chatPOST(jsonRequest("/api/chat", baseBody));
    expect(res.status).toBe(200);
    await res.text();
    expect(enqueueMock).toHaveBeenCalledOnce();
    expect(enqueueCalls[0].mode).toBe("chat");
  });
});
