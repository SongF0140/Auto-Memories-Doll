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

    return result.toTextStreamResponse({
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
