import { NextRequest, NextResponse } from "next/server";
import { AgentDispatcher } from "../../../features/agent/dispatcher";
import { chatRequestSchema } from "../../../lib/validation";
import { aiEventStreamToResponse } from "../../../lib/ai";
import { apiError } from "../../../lib/api-response";
import { ErrorCode } from "../../../lib/api-errors";
import { ChatSessionService } from "../../../server/services/chat-session-service";
import { logger } from "../../../lib/logger";

/**
 * POST /api/chat
 * 薄适配层：Zod 校验 → 调度 → 事件流 / JSON 响应
 */
export async function POST(request: NextRequest) {
  const dispatcher = new AgentDispatcher();

  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(apiError(ErrorCode.INVALID_JSON, "请求体必须是合法的 JSON"), { status: 400 });
    }

    const parsed = chatRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(apiError(ErrorCode.VALIDATION_FAILED, parsed.error.issues[0].message), { status: 400 });
    }

    const { messages, mode, sessionId, memoryIds } = parsed.data;

    try {
      new ChatSessionService().appendSnapshot({ sessionId, mode, messages });
    } catch (error) {
      logger.chat.warn("会话 JSONL 持久化失败", { error: (error as Error).message });
    }

    const result = await dispatcher.dispatch(messages, mode, sessionId, memoryIds);

    if (result.type === "stream") {
      return aiEventStreamToResponse(result.stream);
    }

    return NextResponse.json(result.data);
  } catch (error) {
    return NextResponse.json(apiError(ErrorCode.INTERNAL_ERROR, (error as Error).message), { status: 500 });
  } finally {
    dispatcher.close();
  }
}
