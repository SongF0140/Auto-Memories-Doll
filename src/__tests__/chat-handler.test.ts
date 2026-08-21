import { describe, it, expect, beforeEach, vi } from "vitest";
import { ChatHandler } from "../features/chat/handler";
import { AiEvent } from "../lib/ai/ai-events";

// ─────────────────────────────────────────────────────────────
// 可变 mock 状态：每个用例可通过 mocks.xxx.fn.mockXxx 定制行为
// ─────────────────────────────────────────────────────────────
const mocks = vi.hoisted(() => ({
  modelAdapter: {
    generateStream: vi.fn(),
  },
  classifier: {
    classifyAsync: vi.fn(),
    extractMemoryEntity: vi.fn(),
  },
  skillManager: {
    matchSkill: vi.fn(),
    applySkill: vi.fn(),
    close: vi.fn(),
  },
  mcpManager: {
    listAllTools: vi.fn(),
    callTool: vi.fn(),
    close: vi.fn(),
  },
  memoryService: {
    listMemories: vi.fn(),
    getMemory: vi.fn(),
    close: vi.fn(),
  },
  vectorRetriever: {
    search: vi.fn(),
    close: vi.fn(),
  },
  ranker: {
    rankWithMMR: vi.fn(),
  },
  wikiGraph: {
    getNeighbors: vi.fn(),
  },
  profileUpdater: {
    enqueueAnalysis: vi.fn(),
    getInstance: vi.fn(),
  },
  toolCaller: {
    getToolDescriptions: vi.fn(),
    callTool: vi.fn(),
    getAvailableTools: vi.fn(),
  },
  readProfileTags: vi.fn(),
  promptCache: {
    getSystemPrefix: vi.fn(),
    getMemoryCache: vi.fn(),
  },
  registerDefaultTools: vi.fn(),
}));

vi.mock("../lib/ai/model-adapter", () => ({ ModelAdapter: mocks.modelAdapter }));
vi.mock("../features/chat/classifier", () => ({ ChatClassifier: vi.fn(() => mocks.classifier) }));
vi.mock("../lib/prompt/template-manager", () => ({
  TemplateManager: vi.fn(() => ({})),
  initializeTemplates: vi.fn(),
}));
vi.mock("../lib/prompt/cache", () => ({
  PromptCache: { getInstance: () => mocks.promptCache },
}));
vi.mock("../server/services/memory-service", () => ({
  MemoryService: vi.fn(() => mocks.memoryService),
}));
vi.mock("../lib/vector/retriever", () => ({
  VectorRetriever: vi.fn(() => mocks.vectorRetriever),
}));
vi.mock("../lib/vector/ranker", () => ({ Ranker: vi.fn(() => mocks.ranker) }));
vi.mock("../lib/skills/manager", () => ({ SkillManager: vi.fn(() => mocks.skillManager) }));
vi.mock("../lib/mcp/manager", () => ({ McpManager: vi.fn(() => mocks.mcpManager) }));
vi.mock("../lib/graph/wiki-graph", () => ({ WikiGraph: vi.fn(() => mocks.wikiGraph) }));
vi.mock("../lib/storage/index-writer", () => ({ readProfileTags: mocks.readProfileTags }));
vi.mock("../lib/ai/tool-caller", () => ({ ToolCaller: mocks.toolCaller }));
vi.mock("../lib/ai/tool-registry", () => ({ registerDefaultTools: mocks.registerDefaultTools }));
vi.mock("../server/services/profile-updater", () => ({
  ProfileUpdater: { getInstance: () => mocks.profileUpdater },
}));

// ─────────────────────────────────────────────────────────────
// 辅助：构造一段确定性的 AiEvent 流
// ─────────────────────────────────────────────────────────────
function makeFakeStream(events: AiEvent[]): ReadableStream<AiEvent> {
  return new ReadableStream<AiEvent>({
    start(controller) {
      for (const e of events) controller.enqueue(e);
      controller.close();
    },
  });
}

const NORMAL_EVENTS: AiEvent[] = [
  { type: "text_start" },
  { type: "text_delta", content: "你好" },
  { type: "text_delta", content: "，世界" },
  { type: "text_end" },
  { type: "done", finishReason: "stop" },
];

/** 把流读到结束，返回所有事件 */
async function drainStream(stream: ReadableStream<AiEvent>): Promise<AiEvent[]> {
  const out: AiEvent[] = [];
  const reader = stream.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    out.push(value);
  }
  return out;
}

describe("ChatHandler", () => {
  let handler: ChatHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    // 默认桩值
    mocks.modelAdapter.generateStream.mockReturnValue(makeFakeStream(NORMAL_EVENTS));
    mocks.classifier.classifyAsync.mockResolvedValue({
      type: "chat",
      confidence: 0.4,
      entities: {},
      matchedKeywords: [],
    });
    mocks.classifier.extractMemoryEntity.mockResolvedValue(null);
    mocks.skillManager.matchSkill.mockReturnValue(null);
    mocks.memoryService.listMemories.mockReturnValue([]);
    mocks.vectorRetriever.search.mockResolvedValue([]);
    mocks.readProfileTags.mockResolvedValue([]);
    mocks.ranker.rankWithMMR.mockReturnValue([]);
    mocks.wikiGraph.getNeighbors.mockResolvedValue([]);
    mocks.mcpManager.listAllTools.mockResolvedValue([]);
    mocks.toolCaller.getToolDescriptions.mockReturnValue([]);
    mocks.toolCaller.getAvailableTools.mockReturnValue([]);
    mocks.promptCache.getSystemPrefix.mockReturnValue("SYS-PREFIX");
    mocks.promptCache.getMemoryCache.mockImplementation((content: string) =>
      content ? `MEM-BLOCK\n${content}` : "MEM-BLOCK",
    );

    handler = new ChatHandler();
  });

  // ═══════════════════════════════════════════════════════════
  // streamResponse — Agent 循环主入口
  // ═══════════════════════════════════════════════════════════
  describe("streamResponse", () => {
    it("chat 模式：返回完整 AiEvent 流，调用 ModelAdapter.generateStream", async () => {
      const stream = await handler.streamResponse(
        [{ role: "user", content: "你好" }],
        "chat",
        "sess-1",
      );

      const events = await drainStream(stream);
      expect(events.map((e) => e.type)).toEqual([
        "text_start", "text_delta", "text_delta", "text_end", "done",
      ]);
      expect(mocks.modelAdapter.generateStream).toHaveBeenCalledOnce();
    });

    it("chat 模式：不检索记忆（mode !== 'memory' 短路）", async () => {
      await handler.streamResponse(
        [{ role: "user", content: "随便聊聊" }],
        "chat",
        "sess-1",
      );

      expect(mocks.memoryService.listMemories).not.toHaveBeenCalled();
      expect(mocks.vectorRetriever.search).not.toHaveBeenCalled();
    });

    it("memory 模式：调用 retrieveRelevantMemories，记忆内容注入 system message", async () => {
      mocks.memoryService.listMemories.mockReturnValue([
        { id: "m1", title: "T1", summary: "S1", tags: ["a"], titleZh: "", summaryZh: "", tagsZh: [] },
      ]);
      mocks.vectorRetriever.search.mockResolvedValue([{ memoryId: "m1", similarity: 0.9 }]);
      mocks.ranker.rankWithMMR.mockReturnValue([{ memoryId: "m1" }]);
      mocks.wikiGraph.getNeighbors.mockResolvedValue([]);

      await handler.streamResponse(
        [{ role: "user", content: "查一下相关记忆" }],
        "memory",
        "sess-1",
      );

      expect(mocks.vectorRetriever.search).toHaveBeenCalledWith("查一下相关记忆", 10);
      const callArgs = mocks.modelAdapter.generateStream.mock.calls[0][0];
      expect(callArgs.messages[0].role).toBe("system");
      expect(callArgs.messages[0].content).toContain("T1");
      expect(callArgs.messages[0].content).toContain("S1");
    });

    it("memory 模式：readonly=false，工具注入到 generateStream", async () => {
      mocks.toolCaller.getToolDescriptions.mockReturnValue([
        { name: "create_memory", description: "create", schema: {} },
      ]);
      mocks.mcpManager.listAllTools.mockResolvedValue([
        { serverId: "s1", tools: [{ name: "mcp_tool", description: "d", inputSchema: {} }] },
      ]);

      await handler.streamResponse(
        [{ role: "user", content: "保存这个" }],
        "memory",
        "sess-1",
      );

      const callArgs = mocks.modelAdapter.generateStream.mock.calls[0][0];
      expect(callArgs.readonly).toBe(false);
      expect(callArgs.tools).toHaveLength(2);
      expect(callArgs.tools.map((t: any) => t.name)).toContain("create_memory");
      expect(callArgs.tools.map((t: any) => t.name)).toContain("mcp_tool");
    });

    it("chat 模式：readonly=true，仅注入 MCP 工具", async () => {
      mocks.toolCaller.getToolDescriptions.mockReturnValue([
        { name: "create_memory", description: "create", schema: {} },
      ]);
      mocks.mcpManager.listAllTools.mockResolvedValue([
        { serverId: "s1", tools: [{ name: "mcp_read", description: "d", inputSchema: {} }] },
      ]);

      await handler.streamResponse(
        [{ role: "user", content: "hi" }],
        "chat",
        "sess-1",
      );

      const callArgs = mocks.modelAdapter.generateStream.mock.calls[0][0];
      expect(callArgs.readonly).toBe(true);
      // chat 模式不注入内置记忆工具
      expect(callArgs.tools.map((t: any) => t.name)).toEqual(["mcp_read"]);
    });

    it("memory_create 意图：触发 extractMemoryEntity", async () => {
      mocks.classifier.classifyAsync.mockResolvedValue({
        type: "memory_create",
        confidence: 0.9,
        entities: {},
        matchedKeywords: ["记住"],
      });
      mocks.classifier.extractMemoryEntity.mockResolvedValue({
        title: "标题", content: "内容", tags: ["t1"], topic: "ai",
      });

      await handler.streamResponse(
        [{ role: "user", content: "记住这个知识点" }],
        "memory",
        "sess-1",
      );

      expect(mocks.classifier.extractMemoryEntity).toHaveBeenCalledWith("记住这个知识点");
      const callArgs = mocks.modelAdapter.generateStream.mock.calls[0][0];
      // 实体信息注入 system prompt
      expect(callArgs.messages[0].content).toContain("标题");
      expect(callArgs.messages[0].content).toContain("t1");
      expect(callArgs.messages[0].content).toContain("已提取实体");
    });

    it("extractMemoryEntity 抛异常时不影响主流程", async () => {
      mocks.classifier.classifyAsync.mockResolvedValue({
        type: "memory_create", confidence: 0.9, entities: {}, matchedKeywords: ["记住"],
      });
      mocks.classifier.extractMemoryEntity.mockRejectedValue(new Error("LLM down"));

      const stream = await handler.streamResponse(
        [{ role: "user", content: "记住东西" }],
        "memory",
        "sess-1",
      );

      const events = await drainStream(stream);
      expect(events[events.length - 1].type).toBe("done");
    });

    it("Skills 预处理：matchSkill 命中时改写最后一条消息", async () => {
      mocks.skillManager.matchSkill.mockReturnValue({ name: "translate" });
      mocks.skillManager.applySkill.mockReturnValue("翻译后的内容");

      await handler.streamResponse(
        [{ role: "user", content: "原始内容" }],
        "chat",
        "sess-1",
      );

      const callArgs = mocks.modelAdapter.generateStream.mock.calls[0][0];
      const userMsg = callArgs.messages.find((m: any) => m.role === "user");
      expect(userMsg.content).toBe("翻译后的内容");
    });

    it("MCP 工具列表获取失败时不中断主流程", async () => {
      mocks.mcpManager.listAllTools.mockRejectedValue(new Error("MCP 连接失败"));

      const stream = await handler.streamResponse(
        [{ role: "user", content: "hi" }],
        "chat",
        "sess-1",
      );

      const events = await drainStream(stream);
      expect(events[events.length - 1].type).toBe("done");
      // 工具为 undefined（chat 模式无内置工具 + MCP 失败 → 空列表 → undefined）
      const callArgs = mocks.modelAdapter.generateStream.mock.calls[0][0];
      expect(callArgs.tools).toBeUndefined();
    });

    it("对话结束后入队 ProfileUpdater 画像分析", async () => {
      await handler.streamResponse(
        [
          { role: "assistant", content: "上轮" },
          { role: "user", content: "用户说的" },
        ],
        "chat",
        "sess-1",
      );

      expect(mocks.profileUpdater.enqueueAnalysis).toHaveBeenCalledOnce();
      expect(mocks.profileUpdater.enqueueAnalysis.mock.calls[0][0]).toContain("用户说的");
    });

    it("无用户消息时不入队画像分析也不分类", async () => {
      await handler.streamResponse(
        [{ role: "assistant", content: "只有助手" }],
        "chat",
        "sess-1",
      );

      expect(mocks.profileUpdater.enqueueAnalysis).not.toHaveBeenCalled();
      expect(mocks.classifier.classifyAsync).not.toHaveBeenCalled();
    });

    it("会压缩过长对话后再发送给模型", async () => {
      const longConversation = Array.from({ length: 30 }, (_, index) => ({
        role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
        content: `message ${index + 1} ${"x".repeat(40)}`,
      }));

      await handler.streamResponse(
        [...longConversation, { role: "user", content: "最后一条用户消息" }],
        "chat",
        "sess-1",
      );

      const callArgs = mocks.modelAdapter.generateStream.mock.calls[0][0];
      expect(callArgs.messages.length).toBeLessThan(longConversation.length + 2);
      expect(callArgs.messages[0].content).toContain("SYS-PREFIX");
      expect(callArgs.messages.some((message: any) => message.content?.includes("压缩摘要"))).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // generateResponse — 非流式聚合
  // ═══════════════════════════════════════════════════════════
  describe("generateResponse", () => {
    it("从流中收集完整文本并返回", async () => {
      const result = await handler.generateResponse(
        [{ role: "user", content: "hi" }],
        "chat",
        "sess-1",
      );

      expect(result.content).toBe("你好，世界");
    });

    it("memory 模式注入记忆到 system message", async () => {
      mocks.memoryService.listMemories.mockReturnValue([
        { id: "m1", title: "知识A", summary: "摘要A", tags: ["x"], titleZh: "", summaryZh: "", tagsZh: [] },
      ]);
      mocks.vectorRetriever.search.mockResolvedValue([{ memoryId: "m1", similarity: 0.9 }]);
      mocks.ranker.rankWithMMR.mockReturnValue([{ memoryId: "m1" }]);
      mocks.wikiGraph.getNeighbors.mockResolvedValue([]);

      await handler.generateResponse(
        [{ role: "user", content: "查记忆" }],
        "memory",
        "sess-1",
      );

      const callArgs = mocks.modelAdapter.generateStream.mock.calls[0][0];
      expect(callArgs.readonly).toBe(true);
      expect(callArgs.messages[0].content).toContain("知识A");
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 工具管理接口
  // ═══════════════════════════════════════════════════════════
  describe("listAvailableTools", () => {
    it("合并内置工具与 MCP 工具名称", async () => {
      mocks.toolCaller.getAvailableTools.mockReturnValue(["create_memory", "search_memory"]);
      mocks.mcpManager.listAllTools.mockResolvedValue([
        { serverId: "s1", tools: [{ name: "mcp_a" }, { name: "mcp_b" }] },
      ]);

      const tools = await handler.listAvailableTools();
      expect(tools).toEqual(["create_memory", "search_memory", "mcp_a", "mcp_b"]);
    });
  });

  describe("close", () => {
    it("关闭所有子服务", () => {
      handler.close();
      expect(mocks.memoryService.close).toHaveBeenCalled();
      expect(mocks.vectorRetriever.close).toHaveBeenCalled();
      expect(mocks.skillManager.close).toHaveBeenCalled();
      expect(mocks.mcpManager.close).toHaveBeenCalled();
    });
  });
});
