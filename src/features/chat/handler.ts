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
import { SkillManager } from "../../lib/skills/manager";
import { McpManager } from "../../lib/mcp/manager";
import { ToolCaller } from "../../lib/ai/tool-caller";
import { registerDefaultTools } from "../../lib/ai/tool-registry";

export class ChatHandler {
  private templateManager: TemplateManager;
  private memoryService: MemoryService;
  private vectorRetriever: VectorRetriever;
  private ranker: Ranker;
  private skillManager: SkillManager;
  private mcpManager: McpManager;

  constructor() {
    this.templateManager = new TemplateManager();
    initializeTemplates(this.templateManager);
    this.memoryService = new MemoryService();
    this.vectorRetriever = new VectorRetriever();
    this.ranker = new Ranker();
    this.skillManager = new SkillManager();
    this.mcpManager = new McpManager();
    registerDefaultTools();
  }

  async generateResponse(
    messages: ChatMessage[],
    mode: ChatMode,
    sessionId: string
  ): Promise<{ content: string; memoryReferences: { memoryId: string; title: string; relevance: number }[] }> {
    const processedMessages = await this.applySkills(messages);
    const memoryContent = mode === "memory" ? await this.retrieveRelevantMemories(processedMessages) : "";

    const prompt = buildChatPrompt(
      processedMessages.map(m => ({ role: m.role, content: m.content })),
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
    const processedMessages = await this.applySkills(messages);
    const memoryContent = mode === "memory" ? await this.retrieveRelevantMemories(processedMessages) : "";

    const prompt = buildChatPrompt(
      processedMessages.map(m => ({ role: m.role, content: m.content })),
      memoryContent,
      this.templateManager
    );

    yield* StreamHandler.stream(prompt, "mini");
  }

  async executeMcpTool(serverId: string, toolName: string, args: Record<string, any>): Promise<any> {
    return this.mcpManager.callTool(serverId, toolName, args);
  }

  async listAvailableTools(): Promise<string[]> {
    const defaultTools = ToolCaller.getAvailableTools();
    const mcpTools = await this.mcpManager.listAllTools();
    const mcpToolNames = mcpTools.flatMap(t => t.tools.map(tool => tool.name));
    return [...defaultTools, ...mcpToolNames];
  }

  private async applySkills(messages: ChatMessage[]): Promise<ChatMessage[]> {
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage || lastMessage.role !== "user") return messages;

    const skill = this.skillManager.matchSkill(lastMessage.content);
    if (!skill) return messages;

    const processed = [...messages];
    processed[processed.length - 1] = {
      ...lastMessage,
      content: this.skillManager.applySkill(lastMessage.content, skill),
    };

    return processed;
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
    this.skillManager.close();
    this.mcpManager.close();
  }
}
