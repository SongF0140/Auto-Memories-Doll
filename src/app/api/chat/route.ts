import { NextRequest, NextResponse } from "next/server";
import { ChatHandler } from "../../../features/chat/handler";
import { ChatClassifier } from "../../../features/chat/classifier";
import { ChatExtractor } from "../../../features/chat/extractor";
import { MemoryService } from "../../../server/services/memory-service";
import { ChatMode } from "../../../types/api";

export async function POST(request: NextRequest) {
  const handler = new ChatHandler();

  try {
    const { messages, mode = "chat", sessionId, memoryIds } = await request.json();

    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json(
        { error: "messages is required and must be an array" },
        { status: 400 },
      );
    }

    const classifier = new ChatClassifier();
    const lastMessage = messages[messages.length - 1];
    const intent = classifier.classify(lastMessage.content);

    // ── 记忆操作类意图走本地处理 ──
    if (intent.type === "memory_create") {
      const memoryService = new MemoryService();
      try {
        const extractor = new ChatExtractor();
        const memoryRecord = extractor.buildMemoryRecord("chat", "chat", messages);
        const memoryId = await memoryService.createMemory(
          memoryRecord.source,
          memoryRecord.sourceType,
          memoryRecord.title,
          memoryRecord.content,
          memoryRecord.summary,
          memoryRecord.tags,
        );
        return NextResponse.json({ content: `已保存记忆: ${memoryRecord.title}`, memoryId });
      } finally {
        memoryService.close();
      }
    }

    if (intent.type === "memory_query") {
      const memoryService = new MemoryService();
      try {
        const all = memoryService.listMemories();
        const matched = all.filter(
          (m) =>
            m.tags.some((t) => lastMessage.content.includes(t)) ||
            m.title.includes(lastMessage.content.replace(/查询|查找|搜索|回忆/g, "").trim()) ||
            m.summary.includes(lastMessage.content.replace(/查询|查找|搜索|回忆/g, "").trim()),
        );
        if (matched.length === 0) {
          return NextResponse.json({ content: "没有找到相关记忆。", memoryReferences: [] });
        }
        const result = matched.slice(0, 5).map((m) => ({
          memoryId: m.id,
          title: m.title,
          relevance: 1.0,
        }));
        return NextResponse.json({
          content: `找到 ${matched.length} 条相关记忆:\n${matched.map((m) => `- ${m.title}: ${m.summary}`).join("\n")}`,
          memoryReferences: result,
        });
      } finally {
        memoryService.close();
      }
    }

    if (intent.type === "memory_delete") {
      const memoryService = new MemoryService();
      try {
        const all = memoryService.listMemories();
        const toDelete = all.find((m) => lastMessage.content.includes(m.title));
        if (toDelete) {
          memoryService.deleteMemory(toDelete.id);
          return NextResponse.json({ content: `已删除记忆: ${toDelete.title}` });
        }
        return NextResponse.json({ content: "未找到要删除的记忆，请提供记忆标题。" });
      } finally {
        memoryService.close();
      }
    }

    if (intent.type === "memory_update") {
      const memoryService = new MemoryService();
      try {
        const all = memoryService.listMemories();
        const toUpdate = all.find((m) => lastMessage.content.includes(m.title));
        if (toUpdate) {
          memoryService.updateMemory(toUpdate.id, {
            updatedAt: new Date().toISOString(),
          });
          return NextResponse.json({ content: `已更新记忆: ${toUpdate.title}` });
        }
        return NextResponse.json({ content: "未找到要更新的记忆，请提供记忆标题。" });
      } finally {
        memoryService.close();
      }
    }

    if (intent.type === "system_command") {
      const cmd = intent.entities.command || lastMessage.content.substring(1);
      if (cmd === "help" || cmd === "帮助") {
        return NextResponse.json({
          content: "可用命令:\n/help - 显示帮助\n/记忆 - 列出所有记忆\n/标签 - 列出所有标签",
        });
      }
      return NextResponse.json({ content: `未知命令: /${cmd}，输入 /help 查看帮助` });
    }

    // ── 默认：流式 AI 对话 ──
    const result = await handler.streamResponse(messages, mode as ChatMode, sessionId, memoryIds);
    return result.toTextStreamResponse({
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  } finally {
    handler.close();
  }
}
