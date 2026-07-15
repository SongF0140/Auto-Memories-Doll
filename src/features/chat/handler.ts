import { ChatMessage, ChatMode } from "../../types/api";
import { MemoryRecord } from "../../types/memory";
import { ModelAdapter } from "../../lib/ai/model-adapter";
import { StreamHandler } from "../../lib/ai/stream-handler";
import { TemplateManager, initializeTemplates } from "../../lib/prompt/template-manager";
import { buildChatPrompt } from "../../lib/prompt/builder";
import { MemoryService } from "../../server/services/memory-service";
import { VectorRetriever } from "../../lib/vector/retriever";
import { Ranker } from "../../lib/vector/ranker";
import { readProfileTags } from "../../lib/storage/index-writer";

export class ChatHandler {
  private templateManager: TemplateManager;
  private memoryService: MemoryService;
  private vectorRetriever: VectorRetriever;
  private ranker: Ranker;

  constructor() {
    this.templateManager = new TemplateManager();
    initializeTemplates(this.templateManager);
    this.memoryService = new MemoryService();
    this.vectorRetriever = new VectorRetriever();
    this.ranker = new Ranker();
  }

  async generateResponse(
    messages: ChatMessage[],
    mode: ChatMode,
    sessionId: string
  ): Promise<{ content: string; memoryReferences: { memoryId: string; title: string; relevance: number }[] }> {
    const memoryContent = mode === "memory" ? await this.retrieveRelevantMemories(messages) : "";
    
    const prompt = buildChatPrompt(
      messages.map(m => ({ role: m.role, content: m.content })),
      memoryContent,
      this.templateManager
    );

    const response = await ModelAdapter.generate(prompt, "mini");
    
    return {
      content: response.content,
      memoryReferences: [],
    };
  }

  async *streamResponse(
    messages: ChatMessage[],
    mode: ChatMode,
    sessionId: string
  ): AsyncGenerator<string> {
    const memoryContent = mode === "memory" ? await this.retrieveRelevantMemories(messages) : "";
    
    const prompt = buildChatPrompt(
      messages.map(m => ({ role: m.role, content: m.content })),
      memoryContent,
      this.templateManager
    );

    yield* StreamHandler.stream(prompt, "mini");
  }

  private async retrieveRelevantMemories(messages: ChatMessage[]): Promise<string> {
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage) return "";

    const memories = this.memoryService.listMemories();
    if (memories.length === 0) return "";

    const results = await this.vectorRetriever.search(lastMessage.content, 10);
    
    const profileTags = await readProfileTags();
    const memoryMap = new Map(memories.map(m => [m.id, m]));
    
    const rankedResults = this.ranker.rank(results, memoryMap, profileTags);
    
    const relevantMemories = rankedResults
      .slice(0, 5)
      .map(r => memoryMap.get(r.memoryId))
      .filter((m): m is MemoryRecord => m !== undefined);

    relevantMemories.forEach(m => this.memoryService.incrementAccess(m.id));

    return relevantMemories
      .map(m => `标题: ${m.title}\n摘要: ${m.summary}\n标签: ${m.tags.join(", ")}`)
      .join("\n\n---\n\n");
  }

  close(): void {
    this.memoryService.close();
    this.vectorRetriever.close();
  }
}