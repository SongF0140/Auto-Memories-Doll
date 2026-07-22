import { NextRequest, NextResponse } from "next/server";
import { ChatHandler } from "../../../features/chat/handler";
import { ChatClassifier } from "../../../features/chat/classifier";
import { ChatExtractor } from "../../../features/chat/extractor";
import { MemoryService } from "../../../server/services/memory-service";
import { ChatMessage, ChatMode } from "../../../types/api";

export async function POST(request: NextRequest) {
  const handler = new ChatHandler();

  try {
    const { messages, mode = "chat", sessionId } = await request.json();

    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json(
        { error: "messages is required and must be an array" },
        { status: 400 }
      );
    }

    const classifier = new ChatClassifier();
    const extractor = new ChatExtractor();

    const lastMessage = messages[messages.length - 1];
    const intent = classifier.classify(lastMessage.content);

    if (intent.type === "memory_create") {
      const memoryService = new MemoryService();
      try {
        const memoryRecord = extractor.buildMemoryRecord(
          "chat",
          "chat",
          messages
        );
        const memoryId = await memoryService.createMemory(
          memoryRecord.source,
          memoryRecord.sourceType,
          memoryRecord.title,
          memoryRecord.content,
          memoryRecord.summary,
          memoryRecord.tags
        );

        return NextResponse.json({
          content: `已保存记忆: ${memoryRecord.title}`,
          memoryId,
        });
      } finally {
        memoryService.close();
      }
    }

    const result = await handler.streamResponse(messages, mode as ChatMode, sessionId);

    // 使用 Vercel AI SDK 原生文本流响应
    return result.toTextStreamResponse({
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  } finally {
    handler.close();
  }
}
