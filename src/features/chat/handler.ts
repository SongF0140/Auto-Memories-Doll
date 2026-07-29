import { streamText, StreamTextResult } from "ai";
import { ChatMessage, ChatMode } from "../../types/api";
import { MemoryRecord } from "../../types/memory";
import { ModelAdapter } from "../../lib/ai/model-adapter";
import { createLanguageModel } from "../../lib/ai/provider";
import { TemplateManager, initializeTemplates } from "../../lib/prompt/template-manager";
import { PromptCache } from "../../lib/prompt/cache";
import { MemoryService } from "../../server/services/memory-service";
import { VectorRetriever } from "../../lib/vector/retriever";
import { Ranker } from "../../lib/vector/ranker";
import { readProfileTags } from "../../lib/storage/index-writer";
import { SkillManager } from "../../lib/skills/manager";
import { McpManager } from "../../lib/mcp/manager";
import { ToolCaller } from "../../lib/ai/tool-caller";
import { registerDefaultTools } from "../../lib/ai/tool-registry";
import { ProfileUpdater } from "../../server/services/profile-updater";
import { WikiGraph } from "../../lib/graph/wiki-graph";

/** 模板内容哈希，模板变更时缓存自动失效 */
const TEMPLATE_HASH = "chat-memory-v3";

export class ChatHandler {
  private templateManager: TemplateManager;
  private memoryService: MemoryService;
  private vectorRetriever: VectorRetriever;
  private ranker: Ranker;
  private skillManager: SkillManager;
  private mcpManager: McpManager;
  private wikiGraph: WikiGraph;

  constructor() {
    this.templateManager = new TemplateManager();
    initializeTemplates(this.templateManager);
    this.memoryService = new MemoryService();
    this.vectorRetriever = new VectorRetriever();
    this.ranker = new Ranker();
    this.skillManager = new SkillManager();
    this.mcpManager = new McpManager();
    this.wikiGraph = new WikiGraph();
    registerDefaultTools();
  }

  async generateResponse(
    messages: ChatMessage[],
    mode: ChatMode,
    sessionId: string,
    memoryIds?: string[],
  ): Promise<{
    content: string;
    memoryReferences: { memoryId: string; title: string; relevance: number }[];
  }> {
    const processedMessages = await this.applySkills(messages);
    const memoryContent =
      mode === "memory" ? await this.retrieveRelevantMemories(processedMessages, memoryIds) : "";

    const prompt = this.buildPrompt(processedMessages, memoryContent);

    const response = await ModelAdapter.generate(prompt, "mini");

    // 对话结束后入队画像分析
    const lastUserMsg = processedMessages.findLast((m) => m.role === "user");
    if (lastUserMsg) {
      ProfileUpdater.getInstance().enqueueAnalysis(`${lastUserMsg.role}: ${lastUserMsg.content}`);
    }

    return {
      content: response.content,
      memoryReferences: [],
    };
  }

  async streamResponse(
    messages: ChatMessage[],
    mode: ChatMode,
    _sessionId: string,
    memoryIds?: string[],
  ): Promise<StreamTextResult<any, any, any>> {
    const processedMessages = await this.applySkills(messages);
    const memoryContent =
      mode === "memory" ? await this.retrieveRelevantMemories(processedMessages, memoryIds) : "";

    const prompt = this.buildPrompt(processedMessages, memoryContent);

    // 对话结束后入队画像分析
    const lastUserMsg = processedMessages.findLast((m) => m.role === "user");
    if (lastUserMsg) {
      ProfileUpdater.getInstance().enqueueAnalysis(`${lastUserMsg.role}: ${lastUserMsg.content}`);
    }

    return streamText({
      model: createLanguageModel(),
      messages: [{ role: "user", content: prompt }],
    });
  }

  /**
   * 构建完整 prompt：缓存前缀（系统提示词 + 用户画像）+ 动态记忆 + 对话历史
   */
  private buildPrompt(
    messages: { role: string; content: string }[],
    memoryContent: string,
  ): string {
    const promptCache = PromptCache.getInstance();
    const systemPrefix = promptCache.getSystemPrefix(TEMPLATE_HASH);
    const memoryBlock = promptCache.getMemoryCache(memoryContent);

    const conversationHistory = messages
      .slice(-10)
      .map((msg) => `${msg.role}: ${msg.content}`)
      .join("\n");

    return `${systemPrefix}

${memoryBlock}

## 对话历史
${conversationHistory}

你现在要以记忆伴侣的身份，根据以上信息为用户提供最贴心的回答。`;
  }

  async executeMcpTool(
    serverId: string,
    toolName: string,
    args: Record<string, any>,
  ): Promise<any> {
    return this.mcpManager.callTool(serverId, toolName, args);
  }

  async listAvailableTools(): Promise<string[]> {
    const defaultTools = ToolCaller.getAvailableTools();
    const mcpTools = await this.mcpManager.listAllTools();
    const mcpToolNames = mcpTools.flatMap((t) => t.tools.map((tool) => tool.name));
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

  private async retrieveRelevantMemories(
    messages: ChatMessage[],
    selectedMemoryIds?: string[],
  ): Promise<string> {
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage) return "";

    const memories = this.memoryService.listMemories();
    if (memories.length === 0) return "";

    const memoryMap = new Map(memories.map((m) => [m.id, m]));

    // 优先收集用户手动选中的记忆
    const selectedMemories: MemoryRecord[] = [];
    if (selectedMemoryIds && selectedMemoryIds.length > 0) {
      for (const id of selectedMemoryIds) {
        const mem = memoryMap.get(id);
        if (mem) selectedMemories.push(mem);
      }
    }

    // 向量检索补充相关记忆
    const results = await this.vectorRetriever.search(lastMessage.content, 10);
    const profileTags = await readProfileTags();
    const rankedResults = this.ranker.rank(results, memoryMap, profileTags);

    const relevantMemories: MemoryRecord[] = [...selectedMemories];

    for (const r of rankedResults) {
      if (relevantMemories.length >= 8) break;
      const mem = memoryMap.get(r.memoryId);
      if (mem && !relevantMemories.some((m) => m.id === mem.id)) {
        relevantMemories.push(mem);
      }
    }

    relevantMemories.forEach((m) => this.memoryService.incrementAccess(m.id));

    // 图谱扩展：纳入关联记忆的邻居
    const expandedIds = new Set(relevantMemories.map((m) => m.id));
    for (const mem of relevantMemories) {
      const neighbors = this.wikiGraph.getNeighbors(mem.id);
      for (const neighborId of neighbors) {
        if (!expandedIds.has(neighborId)) {
          const neighbor = memoryMap.get(neighborId);
          if (neighbor) {
            relevantMemories.push(neighbor);
            expandedIds.add(neighborId);
          }
        }
      }
    }

    return relevantMemories
      .map(
        (m) =>
          `标题: ${m.titleZh || m.title}\n摘要: ${m.summaryZh || m.summary}\n标签: ${(m.tagsZh && m.tagsZh.length > 0 ? m.tagsZh : m.tags).join(", ")}`,
      )
      .join("\n\n---\n\n");
  }

  close(): void {
    this.memoryService.close();
    this.vectorRetriever.close();
    this.skillManager.close();
    this.mcpManager.close();
  }
}
