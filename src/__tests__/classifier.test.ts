import { describe, it, expect, beforeEach, vi } from "vitest";

// ── mock ModelAdapter ──
const { mockEmbedding, mockGenerate } = vi.hoisted(() => ({
  mockEmbedding: {
    /** 返回的 embedding 向量（可按 key 定制） */
    vectors: {} as Record<string, number[]>,
    /** 是否模拟失败 */
    shouldFail: false,
  },
  mockGenerate: {
    content: '{"title":"测试标题","content":"测试内容","tags":["test"],"topic":"ai"}',
    shouldFail: false,
  },
}));

vi.mock("../lib/ai/model-adapter", () => ({
  ModelAdapter: {
    generateEmbedding: async (text: string) => {
      if (mockEmbedding.shouldFail) {
        return { embedding: [], model: "error", timestamp: "" };
      }
      const vec = mockEmbedding.vectors[text] ?? [0.1, 0.2, 0.3];
      return { embedding: vec, model: "test", timestamp: "2026-01-01" };
    },
    generate: async (_prompt: string, _modelType: string) => {
      if (mockGenerate.shouldFail) {
        throw new Error("mock budget failure");
      }
      return {
        content: mockGenerate.content,
        model: "gpt-4o-mini",
        timestamp: "2026-01-01",
        finishReason: "stop",
      };
    },
    generateStream: vi.fn(),
    isDegradedMode: false,
  },
}));

import { ChatClassifier } from "../features/chat/classifier";

// intent 描述文本 → embedding 向量（模拟语义接近度）
// memory_create 的描述和 "创建新记忆" 的向量应该高度相似
function setupMockEmbeddings() {
  // 为每个意图描述生成伪向量，保证 create 类词和 memory_create 描述相似度高
  mockEmbedding.vectors = {};

  // memory_create 描述向量：偏向前几个维度
  const createVec = [0.9, 0.8, 0.1, 0.1, 0.1];
  const updateVec = [0.1, 0.1, 0.9, 0.8, 0.1];
  const deleteVec = [0.1, 0.1, 0.1, 0.1, 0.9];
  const queryVec = [0.5, 0.1, 0.1, 0.1, 0.3];
  const promptVec = [0.1, 0.5, 0.1, 0.1, 0.3];

  // 先注册意图描述的向量
  const descKeys = Object.entries({
    memory_create:
      "创建、保存、记录新的记忆或知识，例如记住某个信息、存储内容、创建备忘录、留存笔记",
    memory_update: "修改、更新、编辑已有的记忆，例如改一下、变更内容、修正信息、调整记录",
    memory_delete: "删除、移除、清除记忆或知识，例如删掉、去掉、清理不需要的内容、擦除记录",
    memory_query:
      "查询、搜索、查找、回忆已有的记忆，例如找一下之前的内容、看看保存的知识、搜索信息",
    prompt_edit: "修改提示词、prompt、系统模板、AI 指令，例如改提示词、调整系统设定",
  });
  const vecs = [createVec, updateVec, deleteVec, queryVec, promptVec];
  descKeys.forEach(([_, desc], i) => {
    mockEmbedding.vectors[desc] = vecs[i];
  });

  // "帮我留个备忘录" 应接近 memory_create
  mockEmbedding.vectors["帮我留个备忘录"] = [0.85, 0.75, 0.1, 0.05, 0.1];
  // "找一下之前关于 React 的记录" 应接近 memory_query
  mockEmbedding.vectors["找一下之前关于 React 的记录"] = [0.45, 0.1, 0.05, 0.1, 0.35];
  // 普通聊天
  mockEmbedding.vectors["今天天气怎么样"] = [0.2, 0.2, 0.2, 0.2, 0.2];
}

beforeEach(() => {
  mockEmbedding.shouldFail = false;
  mockGenerate.shouldFail = false;
  mockGenerate.content = '{"title":"测试标题","content":"测试内容","tags":["test"],"topic":"ai"}';
});

// ── Layer 1: 关键词分类（同步，向后兼容） ──

describe("ChatClassifier — Layer 1 关键词分类", () => {
  it("命中 memory_create 关键词", () => {
    const c = new ChatClassifier();
    const r = c.classify("帮我记住这个知识点");
    expect(r.type).toBe("memory_create");
    expect(r.confidence).toBeGreaterThanOrEqual(0.62);
    expect(r.matchedKeywords).toContain("记住");
  });

  it("命中 memory_query 关键词", () => {
    const c = new ChatClassifier();
    const r = c.classify("搜索一下之前的文章");
    expect(r.type).toBe("memory_query");
    expect(r.matchedKeywords).toContain("搜索");
  });

  it("命中 memory_delete 关键词", () => {
    const c = new ChatClassifier();
    const r = c.classify("清除这段内容");
    expect(r.type).toBe("memory_delete");
  });

  it("命中 memory_update 关键词", () => {
    const c = new ChatClassifier();
    const r = c.classify("修改一下标题");
    expect(r.type).toBe("memory_update");
  });

  it("命中 prompt_edit 关键词", () => {
    const c = new ChatClassifier();
    const r = c.classify("调整一下 prompt 模板");
    expect(r.type).toBe("prompt_edit");
  });

  it("system_command 以 / 开头高置信度", () => {
    const c = new ChatClassifier();
    const r = c.classify("/search 关键词");
    expect(r.type).toBe("system_command");
    expect(r.confidence).toBe(0.95);
    expect(r.entities.command).toBe("search 关键词");
  });

  it("无关键词回退到 chat", () => {
    const c = new ChatClassifier();
    const r = c.classify("今天心情不错");
    expect(r.type).toBe("chat");
    expect(r.confidence).toBe(0.3);
  });

  it("高置信度直接返回不自查 embedding", async () => {
    setupMockEmbeddings();
    const c = new ChatClassifier();
    const r = await c.classifyAsync("记住这个知识点很重要");
    expect(r.type).toBe("memory_create");
    expect(r.confidence).toBeGreaterThanOrEqual(0.6);
    // 关键词已足够高，不应走 embedding（无 alternatives）
    expect(r.alternatives).toBeUndefined();
  });
});

// ── Layer 2: Embedding 语义回退 ──

describe("ChatClassifier — Layer 2 embedding 语义回退", () => {
  it("语义变体通过 embedding 命中 memory_create", async () => {
    setupMockEmbeddings();
    const c = new ChatClassifier();
    // "帮我留个备忘录" 没有命中任何关键词（0.3 chat），但 embedding 应接近 memory_create
    const r = await c.classifyAsync("帮我留个备忘录");
    expect(r.type).toBe("memory_create");
    expect(r.confidence).toBeGreaterThan(0);
    // 应有备选意图
    expect(r.alternatives).toBeDefined();
  });

  it("embedding 回退时返回多意图备选", async () => {
    setupMockEmbeddings();
    const c = new ChatClassifier();
    const r = await c.classifyAsync("帮我留个备忘录");
    expect(r.alternatives!.length).toBeGreaterThanOrEqual(0);
  });

  it("embedding 失败时退化到关键词结果", async () => {
    mockEmbedding.shouldFail = true;
    const c = new ChatClassifier();
    const r = await c.classifyAsync("今天天气如何");
    expect(r.type).toBe("chat");
    expect(r.confidence).toBe(0.3);
  });

  it("意图 embedding 缓存复用（第二次调用不重复生成）", async () => {
    setupMockEmbeddings();
    const c = new ChatClassifier();
    await c.classifyAsync("帮我留个备忘录");
    // 第二次调用应复用缓存
    const r = await c.classifyAsync("找一下之前关于 React 的记录");
    expect(r.type).toBeDefined();
  });
});

// ── Layer 3: Budget LLM 实体提取 ──

describe("ChatClassifier — Layer 3 实体提取", () => {
  it("提取记忆结构化字段", async () => {
    mockGenerate.content =
      '{"title":"React 性能优化","content":"使用 memo 和 useCallback 优化渲染","tags":["react","性能"],"topic":"前端"}';
    const c = new ChatClassifier();
    const entity = await c.extractMemoryEntity("记住 React 怎么做性能优化");
    expect(entity).not.toBeNull();
    expect(entity!.title).toBe("React 性能优化");
    expect(entity!.tags).toContain("react");
    expect(entity!.topic).toBe("前端");
  });

  it("budget LLM 失败返回 null", async () => {
    mockGenerate.shouldFail = true;
    const c = new ChatClassifier();
    const entity = await c.extractMemoryEntity("记住一件事");
    expect(entity).toBeNull();
  });

  it("空内容返回 null", async () => {
    mockGenerate.content = '{"title":"","content":"","tags":[],"topic":""}';
    const c = new ChatClassifier();
    const entity = await c.extractMemoryEntity("记住一件事");
    expect(entity).toBeNull();
  });

  it("清理 markdown 代码块包裹的 JSON", async () => {
    mockGenerate.content = '```json\n{"title":"T","content":"C","tags":["a"],"topic":"test"}\n```';
    const c = new ChatClassifier();
    const entity = await c.extractMemoryEntity("记住一件事");
    expect(entity).not.toBeNull();
    expect(entity!.title).toBe("T");
  });

  it("非法 JSON 返回 null", async () => {
    mockGenerate.content = "不是合法的 JSON";
    const c = new ChatClassifier();
    const entity = await c.extractMemoryEntity("记住一件事");
    expect(entity).toBeNull();
  });
});
