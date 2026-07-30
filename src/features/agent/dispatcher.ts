import { ChatMessage, ChatMode } from "../../types/api";
import { AiEvent } from "../../lib/ai/ai-events";
import { ChatClassifier } from "../chat/classifier";
import { ChatExtractor } from "../chat/extractor";
import { ChatHandler } from "../chat/handler";
import { MemoryService } from "../../server/services/memory-service";

export type DispatchResult =
  | { type: "json"; data: Record<string, unknown> }
  | { type: "stream"; stream: ReadableStream<AiEvent> };

/**
 * AgentDispatcher — 意图路由与调度
 * 将分类、本地操作、AI 对话的编排逻辑从 HTTP Route 层分离出来
 */
export class AgentDispatcher {
  private classifier = new ChatClassifier();
  private extractor = new ChatExtractor();
  private chatHandler = new ChatHandler();

  async dispatch(
    messages: ChatMessage[],
    mode: ChatMode,
    sessionId: string,
    memoryIds?: string[],
  ): Promise<DispatchResult> {
    const lastMessage = messages[messages.length - 1];
    const intent = this.classifier.classify(lastMessage.content);

    switch (intent.type) {
      case "memory_create":
        return this.handleMemoryCreate(messages);
      case "memory_query":
        return this.handleMemoryQuery(lastMessage.content);
      case "memory_delete":
        return this.handleMemoryDelete(lastMessage.content);
      case "memory_update":
        return this.handleMemoryUpdate(lastMessage.content);
      case "system_command":
        return this.handleSystemCommand(
          intent.entities.command || lastMessage.content.substring(1),
        );
      default: {
        const stream = await this.chatHandler.streamResponse(messages, mode, sessionId, memoryIds);
        return { type: "stream", stream };
      }
    }
  }

  private async handleMemoryCreate(messages: ChatMessage[]): Promise<DispatchResult> {
    const memoryService = new MemoryService();
    try {
      const record = this.extractor.buildMemoryRecord("chat", "chat", messages);
      const memoryId = await memoryService.createMemory(
        record.source, record.sourceType,
        record.title, record.content, record.summary, record.tags,
      );
      return { type: "json", data: { content: `已保存记忆: ${record.title}`, memoryId } };
    } finally {
      memoryService.close();
    }
  }

  private handleMemoryQuery(query: string): DispatchResult {
    const memoryService = new MemoryService();
    try {
      const searchText = query.replace(/查询|查找|搜索|回忆/g, "").trim();
      const all = memoryService.listMemories();
      const matched = all.filter(
        (m) =>
          m.tags.some((t) => query.includes(t)) ||
          m.title.includes(searchText) ||
          m.summary.includes(searchText),
      );
      if (matched.length === 0) {
        return { type: "json", data: { content: "没有找到相关记忆。", memoryReferences: [] } };
      }
      return {
        type: "json",
        data: {
          content: `找到 ${matched.length} 条相关记忆:\n${matched.map((m) => `- ${m.title}: ${m.summary}`).join("\n")}`,
          memoryReferences: matched.slice(0, 5).map((m) => ({
            memoryId: m.id, title: m.title, relevance: 1.0,
          })),
        },
      };
    } finally {
      memoryService.close();
    }
  }

  private handleMemoryDelete(query: string): DispatchResult {
    const memoryService = new MemoryService();
    try {
      const toDelete = memoryService.listMemories().find((m) => query.includes(m.title));
      if (toDelete) {
        memoryService.deleteMemory(toDelete.id);
        return { type: "json", data: { content: `已删除记忆: ${toDelete.title}` } };
      }
      return { type: "json", data: { content: "未找到要删除的记忆，请提供记忆标题。" } };
    } finally {
      memoryService.close();
    }
  }

  private handleMemoryUpdate(query: string): DispatchResult {
    const memoryService = new MemoryService();
    try {
      const toUpdate = memoryService.listMemories().find((m) => query.includes(m.title));
      if (toUpdate) {
        memoryService.updateMemory(toUpdate.id, { updatedAt: new Date().toISOString() });
        return { type: "json", data: { content: `已更新记忆: ${toUpdate.title}` } };
      }
      return { type: "json", data: { content: "未找到要更新的记忆，请提供记忆标题。" } };
    } finally {
      memoryService.close();
    }
  }

  private handleSystemCommand(cmd: string): DispatchResult {
    if (cmd === "help" || cmd === "帮助") {
      return {
        type: "json",
        data: { content: "可用命令:\n/help - 显示帮助\n/记忆 - 列出所有记忆\n/标签 - 列出所有标签" },
      };
    }
    return { type: "json", data: { content: `未知命令: /${cmd}，输入 /help 查看帮助` } };
  }

  close(): void {
    this.chatHandler.close();
  }
}
