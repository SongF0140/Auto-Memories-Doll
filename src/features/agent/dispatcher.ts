import { ChatMessage, ChatMode } from "../../types/api";
import { AiEvent } from "../../lib/ai/ai-events";
import { ChatAction } from "../../lib/validation";
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
 * AgentDispatcher — 显式操作路由与对话调度
 *
 * 第九块契约：明确的记忆操作只能来自整条斜杠命令或 UI 结构化 action，
 * 不做自然语言关键词截获。其余输入一律进入 AI 对话流。
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
    signal?: AbortSignal,
    action?: ChatAction,
  ): Promise<DispatchResult> {
    // UI 结构化 action 优先（最明确的操作来源）
    if (action) {
      return this.handleAction(action);
    }

    const lastMessage = messages[messages.length - 1];
    const intent = this.classifier.classify(lastMessage.content);

    switch (intent.type) {
      case "system_command":
        return this.handleCommand(intent.entities.command || "");
      default: {
        const stream = await this.chatHandler.streamResponse(
          messages,
          mode,
          sessionId,
          memoryIds,
          signal,
        );
        return { type: "stream", stream };
      }
    }
  }

  /** 斜杠命令解析（全句命令，非关键词截获） */
  private handleCommand(commandLine: string): DispatchResult | Promise<DispatchResult> {
    const spaceIndex = commandLine.indexOf(" ");
    const command = (spaceIndex === -1 ? commandLine : commandLine.slice(0, spaceIndex)).trim();
    const rest = spaceIndex === -1 ? "" : commandLine.slice(spaceIndex + 1).trim();

    switch (command) {
      case "remember":
        return this.handleMemoryCreate(rest, messagesOf(rest));
      case "search":
        return this.handleMemoryQuery(rest);
      case "correct":
        return this.handleMemoryCorrect(rest);
      case "delete":
        return this.handleMemoryDeleteById(rest);
      default:
        return {
          type: "json",
          data: {
            content: [
              "可用命令:",
              "/remember <内容> - 保存记忆（待审计）",
              "/search <关键词> - 检索记忆",
              "/correct <记忆ID> <修改指令> - 纠错（按 ID 定位）",
              "/delete <记忆ID> - 删除（按 ID，待审计）",
              "提示：以 / 开头的消息都会被当作命令处理。",
            ].join("\n"),
          },
        };
    }
  }

  /** UI 结构化 action（与斜杠命令同等地位，删除/更新必须带 memoryId） */
  private handleAction(action: ChatAction): DispatchResult | Promise<DispatchResult> {
    switch (action.type) {
      case "create":
        return this.handleMemoryCreate(action.text, messagesOf(action.text));
      case "query":
        return this.handleMemoryQuery(action.text);
      case "update":
        return this.handleMemoryCorrectById(action.memoryId, action.text);
      case "delete":
        return this.handleMemoryDeleteById(action.memoryId);
    }
  }

  private async handleMemoryCreate(
    _text: string,
    messages: ChatMessage[],
  ): Promise<DispatchResult> {
    if (!_text.trim()) {
      return { type: "json", data: { content: "请提供要记住的内容：/remember <内容>" } };
    }
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

      // 向量语义检索 → top-10 → 取 top-5 读取详情
      const results = await retriever.search(searchText, 10);
      if (results.length === 0) {
        return { type: "json", data: { content: "没有找到相关记忆。", memoryReferences: [] } };
      }

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

  /**
   * /delete <id>：删除必须带明确 ID，缺定位不得自动 top1 删除。
   */
  private async handleMemoryDeleteById(idPart: string): Promise<DispatchResult> {
    const id = idPart.trim();
    if (!id) {
      return {
        type: "json",
        data: { content: "删除必须提供记忆 ID，请在检索库中确认后使用 /delete <记忆ID>。" },
      };
    }
    const memoryService = new MemoryService();
    try {
      const memory = memoryService.getMemory(id);
      if (!memory) {
        return { type: "json", data: { content: `未找到 ID 为 ${id} 的记忆。` } };
      }
      memoryService.stageDeleteMemory(memory.id);
      return {
        type: "json",
        data: { content: `已提交删除请求，等待审计处理: ${memory.title}`, memoryId: memory.id },
      };
    } finally {
      memoryService.close();
    }
  }

  /** /correct <id> <指令>：按 ID 定位纠错，不允许无 ID 的语义定位 */
  private async handleMemoryCorrect(commandRest: string): Promise<DispatchResult> {
    const spaceIndex = commandRest.indexOf(" ");
    if (spaceIndex === -1) {
      return {
        type: "json",
        data: { content: "纠正必须提供记忆 ID 和指令：/correct <记忆ID> <修改指令>" },
      };
    }
    const id = commandRest.slice(0, spaceIndex).trim();
    const instruction = commandRest.slice(spaceIndex + 1).trim();
    return this.handleMemoryCorrectById(id, instruction);
  }

  private async handleMemoryCorrectById(id: string, instruction: string): Promise<DispatchResult> {
    if (!id.trim() || !instruction.trim()) {
      return {
        type: "json",
        data: { content: "纠正必须提供记忆 ID 和指令：/correct <记忆ID> <修改指令>" },
      };
    }
    const memoryService = new MemoryService();
    const retriever = new VectorRetriever();
    try {
      // 纠错闭环：按 ID 定位目标记忆 → 按指令改写 → 变更经审计队列落库
      const correction = new MemoryCorrectionService(memoryService, retriever);
      const result = await correction.correct({ memoryId: id.trim(), instruction });
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

  close(): void {
    this.chatHandler.close();
  }
}

/** 从纯文本构造单条用户消息（供 /remember 创建走既有 buildMemoryRecord） */
function messagesOf(text: string): ChatMessage[] {
  return [{ role: "user", content: text }];
}
