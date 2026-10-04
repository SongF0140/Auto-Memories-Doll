import { NextRequest, NextResponse } from "next/server";
import { ChatHandler } from "../../../../features/chat/handler";
import { chatRequestSchema } from "../../../../lib/validation";
import { apiError } from "../../../../lib/api-response";
import { ErrorCode } from "../../../../lib/api-errors";
import { ChatSessionService } from "../../../../server/services/chat-session-service";
import { logger } from "../../../../lib/logger";
import { aiEventStreamToResponse } from "../../../../lib/ai/stream-adapter";

/**
 * POST /api/chat/stream
 * 流式对话入口：AiEvent → SSE。
 *
 * 与 /api/chat 共用 chatRequestSchema 做 Zod 校验，避免与设计规范不一致。
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

  const { messages, mode, sessionId, memoryIds } = parsed.data;
  const handler = new ChatHandler();
  const sessionService = new ChatSessionService();
  let closeHandlerInFinally = true;

  try {
    try {
      sessionService.appendSnapshot({ sessionId, mode, messages });
    } catch (error) {
      logger.chat.warn("会话 JSONL 持久化失败", { error: (error as Error).message });
    }

    const result = await handler.streamResponse(
      messages,
      mode,
      sessionId,
      memoryIds,
      request.signal,
    );
    const persistedStream = sessionService.captureAssistantStream({
      stream: result,
      sessionId,
      mode,
      messages,
      onComplete: () => handler.close(),
    });
    closeHandlerInFinally = false;

    return aiEventStreamToResponse(persistedStream, "text/event-stream");
  } catch (error) {
    return NextResponse.json(apiError(ErrorCode.INTERNAL_ERROR, (error as Error).message), {
      status: 500,
    });
  } finally {
    if (closeHandlerInFinally) handler.close();
  }
}
