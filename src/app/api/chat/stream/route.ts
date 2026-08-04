import { NextRequest, NextResponse } from "next/server";
import { ChatHandler } from "../../../../features/chat/handler";
import { chatRequestSchema } from "../../../../lib/validation";
import { apiError } from "../../../../lib/api-response";
import { ErrorCode } from "../../../../lib/api-errors";

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
    return NextResponse.json(apiError(ErrorCode.INVALID_JSON, "请求体必须是合法的 JSON"), { status: 400 });
  }

  const parsed = chatRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(apiError(ErrorCode.VALIDATION_FAILED, parsed.error.issues[0].message), { status: 400 });
  }

  const { messages, mode, sessionId, memoryIds } = parsed.data;
  const handler = new ChatHandler();

  try {
    const result = await handler.streamResponse(messages, mode, sessionId, memoryIds);

    // 将 AiEvent ReadableStream 转为 SSE Response
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const reader = result.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`));
          }
        } catch (err) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "error", message: String(err) })}\n\n`)
          );
        }
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    return NextResponse.json(apiError(ErrorCode.INTERNAL_ERROR, (error as Error).message), { status: 500 });
  } finally {
    handler.close();
  }
}
