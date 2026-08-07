import { ChatMessage, ChatMode } from "../../types/api";
import { MemoryRecord } from "../../types/memory";
import { ModelAdapter } from "../../lib/ai/model-adapter";
import { AiEvent, AiToolDef } from "../../lib/ai/ai-events";
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
import { ChatClassifier, IntentResult, ExtractedMemoryEntity } from "./classifier";
import { logger } from "../../lib/logger";
import { assembleSystemMessage, SystemBlocks } from "./system-prompt";

/** 模板内容哈希，模板变更时缓存自动失效 */
const TEMPLATE_HASH = "chat-memory-v3";
/** Agent 循环最大工具迭代轮次 */
const MAX_AGENT_ROUNDS = 5;

export class ChatHandler {
  private templateManager: TemplateManager;
  private memoryService: MemoryService;
  private vectorRetriever: VectorRetriever;
  private ranker: Ranker;
  private skillManager: SkillManager;
  private mcpManager: McpManager;
  private wikiGraph: WikiGraph;
  private classifier: ChatClassifier;

  constructor() {
    this.templateManager = new TemplateManager();
    initializeTemplates(this.templateManager);
    this.memoryService = new MemoryService();
    this.vectorRetriever = new VectorRetriever();
    this.ranker = new Ranker();
    this.skillManager = new SkillManager();
    this.mcpManager = new McpManager();
    this.wikiGraph = new WikiGraph();
    this.classifier = new ChatClassifier();
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

    const blocks = this.buildSystemBlocks(memoryContent);
    const systemMessage = assembleSystemMessage(blocks);

    const apiMessages: Array<{ role: "user" | "assistant" | "system"; content: string }> = [
      { role: "system", content: systemMessage },
      ...processedMessages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    ];

    const response = await ModelAdapter.generateStream({
      messages: apiMessages,
      readonly: true,
      modelType: "standard",
    });

    // 非流式响应：从 ReadableStream 收集完整文本
    let content = "";
    const reader = response.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.type === "text_delta" && "content" in value) {
        content += value.content;
      }
    }

    // 对话结束后入队画像分析
    const lastUserMsg = processedMessages.findLast((m) => m.role === "user");
    if (lastUserMsg) {
      ProfileUpdater.getInstance().enqueueAnalysis(`${lastUserMsg.role}: ${lastUserMsg.content}`);
    }

    return {
      content,
      memoryReferences: [],
    };
  }

  /**
   * Agent 循环：支持工具调用的多轮流式响应
   *
   * 流程：
   * 1. Skills 预处理用户消息
   * 2. Memory 模式下检索相关记忆并注入系统提示
   * 3. 构建工具清单（内置 + MCP + Skills）
   * 4. 调用 AI 模型：文本增量 + 工具调用 + 工具结果 → AiEvent 流
   * 5. 持续迭代直到助手不再产生工具调用（最多 MAX_AGENT_ROUNDS 轮）
   * 6. 回合边界以 round_start 事件标记，前端可据此更新 UI
   */
  async streamResponse(
    messages: ChatMessage[],
    mode: ChatMode,
    _sessionId: string,
    memoryIds?: string[],
  ): Promise<ReadableStream<AiEvent>> {
    const processedMessages = await this.applySkills(messages);

    // 意图分类：Layer 1 关键词（<1ms）→ Layer 2 embedding 语义回退（~100ms）
    // 结果注入 system prompt 引导模型选择工具与回复风格
    const lastUserMsg = processedMessages.findLast((m) => m.role === "user");
    const intent = lastUserMsg ? await this.classifier.classifyAsync(lastUserMsg.content) : null;

    // Layer 3: 若意图为记忆创建/更新，用 budget LLM 提取结构化实体
    let extractedEntity: ExtractedMemoryEntity | null = null;
    if (intent && (intent.type === "memory_create" || intent.type === "memory_update") && lastUserMsg) {
      try {
        extractedEntity = await this.classifier.extractMemoryEntity(lastUserMsg.content);
      } catch {
        // 实体提取失败不影响主流程
      }
    }

    const memoryContent =
      mode === "memory" ? await this.retrieveRelevantMemories(processedMessages, memoryIds) : "";

    const blocks = this.buildSystemBlocks(memoryContent, intent, extractedEntity);
    const systemMessage = assembleSystemMessage(blocks);

    // 系统消息 + 原始对话角色，保留多轮上下文的 role 结构
    const apiMessages: Array<{ role: "user" | "assistant" | "system"; content: string }> = [
      { role: "system", content: systemMessage },
      ...processedMessages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    ];

    // 对话结束后入队画像分析（lastUserMsg 已在意图分类时获取）
    if (lastUserMsg) {
      ProfileUpdater.getInstance().enqueueAnalysis(`${lastUserMsg.role}: ${lastUserMsg.content}`);
    }

    // 收集所有可用工具
    const toolDefs = await this.collectToolDefs(mode);

    return ModelAdapter.generateStream({
      messages: apiMessages,
      tools: toolDefs.length > 0 ? toolDefs : undefined,
      readonly: mode !== "memory",
      modelType: "standard",
    });
  }

  /**
   * 收集当前模式下的所有工具定义
   * - memory 模式：内置记忆工具 + MCP 工具
   * - chat 模式：仅 MCP 工具（只读）
   */
  private async collectToolDefs(mode: ChatMode): Promise<AiToolDef[]> {
    const defs: AiToolDef[] = [];

    if (mode === "memory") {
      // 内置记忆工具
      for (const desc of ToolCaller.getToolDescriptions()) {
        defs.push({
          name: desc.name,
          description: desc.description,
          parameters: desc.schema,
          execute: async (args: Record<string, unknown>) => {
            const result = await ToolCaller.callTool({
              toolName: desc.name,
              arguments: args,
            });
            return result.success ? result.data : `错误: ${result.error}`;
          },
        });
      }
    }

    // MCP 工具（所有模式可用）
    // 为每个 MCP 工具包装 execute：调用 mcpManager.callTool 转发到远端服务器
    // 失败时返回错误字符串供模型感知，避免无 execute 的工具被模型调用后卡住
    try {
      const mcpTools = await this.mcpManager.listAllTools();
      for (const { serverId, tools } of mcpTools) {
        for (const t of tools) {
          const toolName = t.name;
          defs.push({
            name: toolName,
            description: t.description || `MCP tool: ${toolName}`,
            parameters: t.inputSchema || {},
            execute: async (args: Record<string, unknown>) => {
              try {
                return await this.mcpManager.callTool(serverId, toolName, args);
              } catch (error) {
                return `MCP 工具 "${toolName}" 执行失败: ${(error as Error).message}`;
              }
            },
          });
        }
      }
    } catch (error) {
      logger.chat.warn("MCP 工具列表获取失败", { error: (error as Error).message });
      // MCP 不可用不影响核心流程
    }

    return defs;
  }

  /**
   * 构建系统消息的各个区块：缓存前缀 + 意图 + 动态记忆。
   * 返回分块数据，由调用方决定如何组装到 system 消息中。
   *
   * 意图块仅在分类结果非 chat 时注入，让 LLM 知道用户意图并据此选择工具调用策略与回复风格。
   */
  private buildSystemBlocks(
    memoryContent: string,
    intent?: IntentResult | null,
    extractedEntity?: ExtractedMemoryEntity | null,
  ): SystemBlocks {
    const promptCache = PromptCache.getInstance();
    const systemPrefix = promptCache.getSystemPrefix(TEMPLATE_HASH);
    const memoryBlock = promptCache.getMemoryCache(memoryContent);

    let intentBlock = "";
    if (intent && intent.type !== "chat") {
      const parts: string[] = [];
      parts.push(`## 用户意图\n${intent.type} (置信度 ${(intent.confidence * 100).toFixed(0)}%)`);
      if (intent.matchedKeywords.length > 0) {
        parts.push(`命中关键词: ${intent.matchedKeywords.join(", ")}`);
      }
      if (intent.alternatives && intent.alternatives.length > 0) {
        const altStr = intent.alternatives
          .map((a) => `${a.type} (${(a.confidence * 100).toFixed(0)}%)`)
          .join(", ");
        parts.push(`备选意图: ${altStr}`);
      }
      if (extractedEntity) {
        parts.push(`\n已提取实体:`);
        if (extractedEntity.title) parts.push(`- 标题: ${extractedEntity.title}`);
        if (extractedEntity.tags.length > 0) parts.push(`- 标签: ${extractedEntity.tags.join(", ")}`);
        if (extractedEntity.topic) parts.push(`- 主题: ${extractedEntity.topic}`);
        if (extractedEntity.content) parts.push(`- 内容摘要: ${extractedEntity.content.substring(0, 200)}`);
      }
      intentBlock = parts.join("\n");
    }

    return { systemPrefix, intentBlock, memoryBlock };
  }

  /**
   * 将系统消息各区块组装为完整 system message 内容。
   */
  private assembleSystemMessage(blocks: SystemBlocks): string {
    return `${blocks.systemPrefix}
${blocks.intentBlock}

${blocks.memoryBlock}

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

    const memories = this.memoryService.listMemories({ limit: 500 });
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

    // 向量检索补充相关记忆 + MMR 重排（相关性与多样性平衡，避免主题重复）
    const results = await this.vectorRetriever.search(lastMessage.content, 10);
    const profileTags = await readProfileTags();
    const rankedResults = this.ranker.rankWithMMR(results, memoryMap, profileTags);

    const relevantMemories: MemoryRecord[] = [...selectedMemories];

    for (const r of rankedResults) {
      if (relevantMemories.length >= 8) break;
      const mem = memoryMap.get(r.memoryId);
      if (mem && !relevantMemories.some((m) => m.id === mem.id)) {
        relevantMemories.push(mem);
      }
    }

    // 注：访问计数（incrementAccess）不应在自动召回时触发，按 AGENTS.md 4.8
    // "搜索回写由前端搜索命中事件触发"——只有用户主动点击/查看记忆时才递增，
    // 否则每次对话都会推高 accessCount 导致 heatScore 失真。

    // 图谱扩展：纳入关联记忆的邻居
    const expandedIds = new Set(relevantMemories.map((m) => m.id));
    for (const mem of relevantMemories) {
      const neighbors = await this.wikiGraph.getNeighbors(mem.id);
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
