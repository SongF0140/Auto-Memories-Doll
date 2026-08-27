import { ChatMessage, ChatMode } from "../../types/api";
import { AiEvent } from "../../lib/ai/ai-events";
import { ChatClassifier } from "../chat/classifier";
import { ChatExtractor } from "../chat/extractor";
import { ChatHandler } from "../chat/handler";
import { MemoryService } from "../../server/services/memory-service";
import { VectorRetriever } from "../../lib/vector/retriever";
import { MemoryCorrectionService } from "../../lib/memory/correction";

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
      const memoryId = memoryService.stageCreateMemory(
        record.source,
        record.sourceType,
        record.title,
        record.content,
        record.summary,
        record.tags,
      );
      return { type: "json", data: { content: `已保存记忆（待审计）: ${record.title}`, memoryId } };
    } finally {
      memoryService.close();
    }
  }

  private async handleMemoryQuery(query: string): Promise<DispatchResult> {
    const memoryService = new MemoryService();
    const retriever = new VectorRetriever();
    try {
      const searchText = query.replace(/查询|查找|搜索|回忆/g, "").trim();
      if (!searchText) {
        return { type: "json", data: { content: "请提供要查询的关键词。", memoryReferences: [] } };
      }

      // 向量语义检索 → 相似度过滤 → top-10
      const results = await retriever.search(searchText, 10);
      if (results.length === 0) {
        return { type: "json", data: { content: "没有找到相关记忆。", memoryReferences: [] } };
      }

      // 取 top-5 并发读取记忆详情
      const topResults = results.slice(0, 5);
      const memories = topResults.map((r) => memoryService.getMemory(r.memoryId)).filter(Boolean);

      const matched = memories.map((m) => ({
        memoryId: m!.id,
        title: m!.title,
        summary: m!.summary,
        relevance: topResults.find((r) => r.memoryId === m!.id)?.similarity ?? 0.5,
      }));

      return {
        type: "json",
        data: {
          content: `找到 ${matched.length} 条相关记忆:\n${matched.map((m) => `- ${m.title}: ${m.summary} (相似度 ${(m.relevance * 100).toFixed(0)}%)`).join("\n")}`,
          memoryReferences: matched,
        },
      };
    } finally {
      retriever.close();
      memoryService.close();
    }
  }

  private async handleMemoryDelete(query: string): Promise<DispatchResult> {
    const memoryService = new MemoryService();
    const retriever = new VectorRetriever();
    try {
      const searchText = query.replace(/删除|移除|去掉/g, "").trim();
      if (!searchText) {
        return { type: "json", data: { content: "请提供要删除的记忆标题或关键词。" } };
      }
      const results = await retriever.search(searchText, 1);
      if (results.length === 0) {
        return { type: "json", data: { content: "未找到要删除的记忆，请提供记忆标题或关键词。" } };
      }
      const memory = memoryService.getMemory(results[0].memoryId);
      if (!memory) {
        return { type: "json", data: { content: "未找到要删除的记忆。" } };
      }
      memoryService.stageDeleteMemory(memory.id);
      return { type: "json", data: { content: `已提交删除请求，等待审计处理: ${memory.title}` } };
    } finally {
      retriever.close();
      memoryService.close();
    }
  }

  private async handleMemoryUpdate(query: string): Promise<DispatchResult> {
    const memoryService = new MemoryService();
    const retriever = new VectorRetriever();
    try {
      const searchText = query.replace(/更新|修改|变更|编辑|改一下|记错|纠正|更正/g, "").trim();
      if (!searchText) {
        return { type: "json", data: { content: "请提供要纠正的记忆标题或关键词。" } };
      }

      // 纠错闭环：定位目标记忆 → 按指令改写 → 变更经审计队列落库
      const correction = new MemoryCorrectionService(memoryService, retriever);
      const result = await correction.correct({ locateQuery: searchText, instruction: query });
      if (!result.success) {
        return { type: "json", data: { content: result.error } };
      }
      return {
        type: "json",
        data: {
          content: `已提交纠错（待审计）: ${result.title}，改动字段: ${result.changedFields.join(", ")}`,
          memoryId: result.memoryId,
          eventId: result.eventId,
        },
      };
    } finally {
      retriever.close();
      memoryService.close();
    }
  }

  private handleSystemCommand(cmd: string): DispatchResult {
    if (cmd === "help" || cmd === "帮助") {
      return {
        type: "json",
        data: {
          content: "可用命令:\n/help - 显示帮助\n/记忆 - 列出所有记忆\n/标签 - 列出所有标签",
        },
      };
    }
    return { type: "json", data: { content: `未知命令: /${cmd}，输入 /help 查看帮助` } };
  }

  close(): void {
    this.chatHandler.close();
  }
}
