import { NextRequest, NextResponse } from "next/server";
import { AgentDispatcher } from "../../../../features/agent/dispatcher";
import { chatRequestSchema } from "../../../../lib/validation";
import { apiError } from "../../../../lib/api-response";
import { ErrorCode } from "../../../../lib/api-errors";
import { ChatSessionService } from "../../../../server/services/chat-session-service";
import { createTurnLearningHook } from "../../../../server/services/conversation-learning-hook";
import { logger } from "../../../../lib/logger";
import { AiEvent } from "../../../../lib/ai/ai-events";
import { aiEventStreamToResponse } from "../../../../lib/ai/stream-adapter";

/** 显式命令的 JSON 结果 → 文本 AiEvent 流（SSE 客户端按常规对话消费） */
function jsonResultToStream(data: Record<string, unknown>): ReadableStream<AiEvent> {
  const content = typeof data.content === "string" ? data.content : JSON.stringify(data);
  return new ReadableStream<AiEvent>({
    start(controller) {
      controller.enqueue({ type: "text_start" });
      controller.enqueue({ type: "text_delta", content });
      controller.enqueue({ type: "text_end" });
      controller.enqueue({ type: "done", finishReason: "stop" });
      controller.close();
    },
  });
}

/**
 * POST /api/chat/stream
 * 流式对话入口：AiEvent → SSE。
 *
 * 与 /api/chat 共用 AgentDispatcher 调度与学习入队钩子（第九块契约 3.4）；
 * 显式命令的 JSON 结果包装为文本流，不悄悄改变客户端事件语义。
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(apiError(ErrorCode.INVALID_JSON, "请求体必须是合法的 JSON"), {
      status: 400,
    });
  }

  const parsed = chatRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      apiError(ErrorCode.VALIDATION_FAILED, parsed.error.issues[0].message),
      { status: 400 },
    );
  }

  const { messages, mode, sessionId, memoryIds, action } = parsed.data;
  const dispatcher = new AgentDispatcher();
  const sessionService = new ChatSessionService();
  let closeDispatcherInFinally = true;

  try {
    try {
      sessionService.appendSnapshot({ sessionId, mode, messages });
    } catch (error) {
      logger.chat.warn("会话 JSONL 持久化失败", { error: (error as Error).message });
    }

    const learningHook = createTurnLearningHook({ sessionId, mode, messages });
    const result = await dispatcher.dispatch(
      messages,
      mode,
      sessionId,
      memoryIds,
      request.signal,
      action,
    );

    // 第九块契约：显式命令/结构化 action 是确定性操作，不作为学习轮次入队
    // （与 /api/chat 的 JSON 分支行为一致，两条 route 对命令轮次都不入队）
    const isExplicitCommand = result.type === "json";

    const source = result.type === "stream" ? result.stream : jsonResultToStream(result.data);

    const persistedStream = sessionService.captureAssistantStream({
      stream: source,
      sessionId,
      mode,
      messages,
      onComplete: (outcome) => {
        try {
          if (!isExplicitCommand) learningHook.onComplete(outcome);
        } finally {
          dispatcher.close();
        }
      },
    });
    closeDispatcherInFinally = false;

    return aiEventStreamToResponse(persistedStream, "text/event-stream");
  } catch (error) {
    return NextResponse.json(apiError(ErrorCode.INTERNAL_ERROR, (error as Error).message), {
      status: 500,
    });
  } finally {
    if (closeDispatcherInFinally) dispatcher.close();
  }
}
