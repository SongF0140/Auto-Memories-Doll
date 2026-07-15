import { NextRequest } from "next/server";
import { ChatHandler } from "../../../../features/chat/handler";
import { ChatMode } from "../../../../types/api";

export async function POST(request: NextRequest) {
  try {
    const { messages, mode = "chat", sessionId } = await request.json();
    
    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(
        JSON.stringify({ error: "messages is required and must be an array" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const handler = new ChatHandler();
    
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of handler.streamResponse(messages, mode as ChatMode, sessionId)) {
            controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ content: chunk })}\n\n`));
          }
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ done: true })}\n\n`));
        } catch (error) {
          controller.error(error);
        } finally {
          controller.close();
          handler.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}