import { describe, it, expect, beforeEach, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMemoryServer } from "../server/mcp/expose-server";
import type { MemoryRecord } from "../types/memory";

/**
 * MCP 暴露端（优先级 #3）测试：InMemoryTransport 全链路——
 * 真实 McpServer 注册 + zod 参数校验 + JSON-RPC 往返，仅 DB 依赖注入为 mock。
 *
 * 只读红线由两层保证：注入类型只暴露读方法（Pick），且工具 handler 无任何写调用。
 */

const retriever = {
  searchDetailed: vi.fn(),
  close: vi.fn(),
};

const memoryService = {
  getMemoriesByIds: vi.fn(),
  listMemories: vi.fn(),
  close: vi.fn(),
};

const reflectService = {
  reflect: vi.fn(),
  close: vi.fn(),
};

function makeCard(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id: "mem-1",
    version: 1,
    source: "collect",
    sourceType: "listen",
    title: "MiniHttp 连接复用设计",
    content: "MiniHttp 采用 keep-alive 连接复用，减少握手开销。",
    summary: "MiniHttp 用 keep-alive 复用连接降低握手开销",
    tags: ["MiniHttp", "网络"],
    topic: "06_network",
    createdAt: "2026-09-20T10:00:00.000Z",
    updatedAt: "2026-09-21T10:00:00.000Z",
    accessedAt: "2026-09-21T10:00:00.000Z",
    accessCount: 0,
    heatScore: 0,
    kind: "fact",
    graphLinks: [],
    status: "active",
    ...overrides,
  };
}

async function connect(server: McpServer): Promise<Client> {
  const client = new Client({ name: "test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

function parseResult(result: any): any {
  expect(result.isError).toBeFalsy();
  expect(result.content).toHaveLength(1);
  expect(result.content[0].type).toBe("text");
  return JSON.parse(result.content[0].text);
}

describe("MCP 暴露端（expose-server）", () => {
  let server: McpServer;

  beforeEach(() => {
    vi.clearAllMocks();
    server = createMemoryServer({
      retriever: retriever as any,
      memoryService: memoryService as any,
      reflectService: reflectService as any,
    });
  });

  it("注册四个只读工具", async () => {
    const client = await connect(server);
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "get_memory",
      "list_recent_memories",
      "reflect_memory",
      "search_memory",
    ]);
    for (const tool of tools) {
      // 工具描述面向外部 agent，必须说明只读语义
      expect(tool.description).toContain("只读");
    }
    await client.close();
  });

  it("search_memory：检索结果携带相似度与路由，默认不带全文", async () => {
    retriever.searchDetailed.mockResolvedValue({
      results: [{ memoryId: "mem-1", similarity: 0.5 }],
      mode: "hybrid",
      route: "multi-hop",
    });
    const card = makeCard();
    memoryService.getMemoriesByIds.mockReturnValue([card]);

    const client = await connect(server);
    const payload = parseResult(
      await client.callTool({ name: "search_memory", arguments: { query: "MiniHttp 连接复用" } }),
    );

    expect(retriever.searchDetailed).toHaveBeenCalledWith("MiniHttp 连接复用", 10);
    expect(memoryService.getMemoriesByIds).toHaveBeenCalledWith(["mem-1"]);
    expect(payload.route).toBe("multi-hop");
    expect(payload.count).toBe(1);
    // 库中不存在的 id（竞态删除）被静默丢弃
    expect(payload.results).toHaveLength(1);
    expect(payload.results[0]).toMatchObject({
      id: "mem-1",
      title: card.title,
      summary: card.summary,
      similarity: 0.5,
    });
    expect(payload.results[0].content).toBeUndefined();
    await client.close();
  });

  it("search_memory：withContent 附带预览，超长正文截断并提示 get_memory", async () => {
    retriever.searchDetailed.mockResolvedValue({
      results: [{ memoryId: "mem-1", similarity: 0.5 }],
      mode: "vector",
      route: "single-hop",
    });
    const longContent = "长".repeat(500);
    memoryService.getMemoriesByIds.mockReturnValue([
      makeCard({ content: longContent }),
    ]);

    const client = await connect(server);
    const payload = parseResult(
      await client.callTool({
        name: "search_memory",
        arguments: { query: "任意", limit: 1, withContent: true },
      }),
    );

    expect(retriever.searchDetailed).toHaveBeenCalledWith("任意", 1);
    expect(payload.results[0].content).toContain("全文用 get_memory 按 id 获取");
    expect((payload.results[0].content as string).length).toBeLessThan(340);
    await client.close();
  });

  it("get_memory：返回完整卡片；id 不存在时返回 isError", async () => {
    memoryService.getMemoriesByIds.mockImplementation((ids: string[]) =>
      ids[0] === "mem-1" ? [makeCard({ confidence: 0.8, supersededBy: undefined })] : [],
    );

    const client = await connect(server);
    const full = parseResult(await client.callTool({ name: "get_memory", arguments: { id: "mem-1" } }));
    expect(full.content).toBe("MiniHttp 采用 keep-alive 连接复用，减少握手开销。");
    expect(full.graphLinks).toEqual([]);
    expect(full.status).toBe("active");
    expect(full.confidence).toBe(0.8);

    const miss = await client.callTool({ name: "get_memory", arguments: { id: "nope" } });
    expect(miss.isError).toBe(true);
    expect((miss.content as any[])[0].text).toContain("未找到记忆卡片");
    await client.close();
  });

  it("list_recent_memories：传递过滤参数并返回卡片列表", async () => {
    memoryService.listMemories.mockReturnValue([
      makeCard(),
      makeCard({ id: "mem-2", title: "第二条" }),
    ]);

    const client = await connect(server);
    const payload = parseResult(
      await client.callTool({
        name: "list_recent_memories",
        arguments: { limit: 5, topic: "06_network", tag: "MiniHttp" },
      }),
    );

    expect(memoryService.listMemories).toHaveBeenCalledWith({
      limit: 5,
      sortBy: "updatedAt",
      topic: "06_network",
      tag: "MiniHttp",
    });
    expect(payload.count).toBe(2);
    expect(payload.results.map((r: any) => r.id)).toEqual(["mem-1", "mem-2"]);
    await client.close();
  });

  it("reflect_memory：透传 query/disposition/limit，返回推理结构", async () => {
    reflectService.reflect.mockResolvedValue({
      query: "X 和 Y 哪个对",
      disposition: "skeptical",
      answer: "依据 mem-1 与 mem-2 矛盾（卡: mem-1）",
      usedMemoryIds: ["mem-1", "mem-2"],
      memories: [{ id: "mem-1", title: "t", summary: "s", similarity: 0.8 }],
      degraded: false,
    });

    const client = await connect(server);
    const payload = parseResult(
      await client.callTool({
        name: "reflect_memory",
        arguments: { query: "X 和 Y 哪个对", disposition: "skeptical", limit: 4 },
      }),
    );

    expect(reflectService.reflect).toHaveBeenCalledWith("X 和 Y 哪个对", "skeptical", 4);
    expect(payload.answer).toContain("矛盾");
    expect(payload.usedMemoryIds).toEqual(["mem-1", "mem-2"]);
    await client.close();
  });

  it("reflect_memory：非法 disposition 被 zod 拦截，不触达 handler", async () => {
    const client = await connect(server);
    const result = await client.callTool({
      name: "reflect_memory",
      arguments: { query: "q", disposition: "aggressive" },
    });

    expect(result.isError).toBe(true);
    expect(reflectService.reflect).not.toHaveBeenCalled();
    await client.close();
  });

  it("zod 校验：query 必填、limit 越界被拒", async () => {
    const client = await connect(server);

    const missingQuery = await client.callTool({ name: "search_memory", arguments: {} });
    expect(missingQuery.isError).toBe(true);

    const badLimit = await client.callTool({
      name: "search_memory",
      arguments: { query: "x", limit: 999 },
    });
    expect(badLimit.isError).toBe(true);
    await client.close();
  });

  it("handler 异常不炸协议层：返回 isError 文本", async () => {
    retriever.searchDetailed.mockRejectedValue(new Error("db locked"));
    const client = await connect(server);
    const result = await client.callTool({
      name: "search_memory",
      arguments: { query: "任意" },
    });
    expect(result.isError).toBe(true);
    expect((result.content as any[])[0].text).toContain("检索失败");
    await client.close();
  });
});
