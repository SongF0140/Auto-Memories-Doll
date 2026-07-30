import { NextRequest } from "next/server";
import { ChatHandler } from "../../../../features/chat/handler";
import { ChatMode } from "../../../../types/api";

export async function POST(request: NextRequest) {
  const handler = new ChatHandler();

  try {
    const { messages, mode = "chat", sessionId } = await request.json();

    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: "messages is required and must be an array" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const result = await handler.streamResponse(messages, mode as ChatMode, sessionId);

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
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  } finally {
    handler.close();
  }
}
