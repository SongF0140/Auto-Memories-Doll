import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classifyQuery } from "../lib/vector/query-classifier";
import {
  extractDate,
  extractTemporalAnchor,
  rankTemporal,
  stripTemporalClause,
  TemporalMeta,
} from "../lib/vector/temporal";
import { RankedHit } from "../lib/vector/fusion";
import { ModelAdapter } from "../lib/ai/model-adapter";
import { VectorRetriever } from "../lib/vector/retriever";

describe("classifyQuery temporal 路由（阶段二）", () => {
  it("时间意图词路由到 temporal", () => {
    const queries = [
      "最后一次调整部署平台是什么时候？",
      "哪一天决定用 Zustand",
      "什么时候上线的",
      "何时迁移到 Netlify",
      "最近一次改配置",
      "项目时间线",
    ];
    queries.forEach((query) => {
      expect(classifyQuery(query)).toBe("temporal");
    });
  });

  it("temporal 优先于 multi-hop 与 overview（时间词更特异）", () => {
    expect(classifyQuery("对比一下两次部署哪天更稳")).toBe("temporal");
    expect(classifyQuery("总结一下什么时候上线")).toBe("temporal");
  });

  it("无时间意图的普通查询不受影响", () => {
    expect(classifyQuery("部署平台怎么配")).toBe("single-hop");
    expect(classifyQuery("")).toBe("single-hop");
  });
});

describe("extractTemporalAnchor", () => {
  it("解析'在 X 之前'锚定子句", () => {
    expect(
      extractTemporalAnchor("在决定用 Zustand 之前，最后一次调整部署平台是什么时候？"),
    ).toEqual({ text: "决定用 Zustand", direction: "before" });
  });

  it("解析'在 X 之后'锚定子句", () => {
    expect(extractTemporalAnchor("在上线之后还改过配置吗")).toEqual({
      text: "上线",
      direction: "after",
    });
  });

  it("无锚定子句返回 null", () => {
    expect(extractTemporalAnchor("部署平台最后一次调整是什么时候？")).toBeNull();
    expect(extractTemporalAnchor("")).toBeNull();
  });
});

describe("stripTemporalClause", () => {
  it("剥离锚定子句并清理残留标点", () => {
    expect(stripTemporalClause("在决定用 Zustand 之前，最后一次调整部署平台是什么时候？")).toBe(
      "最后一次调整部署平台是什么时候？",
    );
  });

  it("无锚定子句时返回原查询", () => {
    expect(stripTemporalClause("最后一次调整部署平台是什么时候？")).toBe(
      "最后一次调整部署平台是什么时候？",
    );
  });
});

describe("extractDate", () => {
  it("支持 ISO / 斜杠 / 中文日期格式并归一化为 yyyy-mm-dd", () => {
    expect(extractDate("2026-05-10 完成切换")).toBe("2026-05-10");
    expect(extractDate("2026/3/5 上线")).toBe("2026-03-05");
    expect(extractDate("2026年3月25日 决定")).toBe("2026-03-25");
  });

  it("无日期返回 null", () => {
    expect(extractDate("没有任何日期的正文")).toBeNull();
    expect(extractDate("")).toBeNull();
  });
});

describe("rankTemporal", () => {
  const meta = (memoryId: string, createdAt?: string): TemporalMeta => ({ memoryId, createdAt });

  it("before 方向过滤掉锚定日当天及之后的候选", () => {
    const fused: RankedHit[] = [
      { memoryId: "new", similarity: 0.9 },
      { memoryId: "old", similarity: 0.8 },
    ];
    const metaMap = new Map([
      ["new", meta("new", "2026-06-20T00:00:00.000Z")],
      ["old", meta("old", "2026-05-01T00:00:00.000Z")],
    ]);
    const result = rankTemporal(fused, metaMap, { text: "锚", direction: "before" }, "2026-06-01");
    expect(result.map((hit) => hit.memoryId)).toEqual(["old"]);
  });

  it("after 方向过滤掉锚定日当天及之前的候选", () => {
    const fused: RankedHit[] = [
      { memoryId: "early", similarity: 0.9 },
      { memoryId: "late", similarity: 0.8 },
    ];
    const metaMap = new Map([
      ["early", meta("early", "2026-05-01T00:00:00.000Z")],
      ["late", meta("late", "2026-06-20T00:00:00.000Z")],
    ]);
    const result = rankTemporal(fused, metaMap, { text: "锚", direction: "after" }, "2026-06-01");
    expect(result.map((hit) => hit.memoryId)).toEqual(["late"]);
  });

  it("无日期元数据的候选不被误杀", () => {
    const fused: RankedHit[] = [
      { memoryId: "no-date", similarity: 0.9 },
      { memoryId: "late", similarity: 0.8 },
    ];
    const metaMap = new Map([
      ["no-date", meta("no-date")],
      ["late", meta("late", "2026-06-20T00:00:00.000Z")],
    ]);
    const result = rankTemporal(fused, metaMap, { text: "锚", direction: "before" }, "2026-06-01");
    expect(result.map((hit) => hit.memoryId)).toEqual(["no-date"]);
  });

  it("过滤清空时回退未过滤集合，宁可宽松也不空手而归", () => {
    const fused: RankedHit[] = [{ memoryId: "only", similarity: 0.9 }];
    const metaMap = new Map([["only", meta("only", "2026-06-20T00:00:00.000Z")]]);
    const result = rankTemporal(fused, metaMap, { text: "锚", direction: "before" }, "2026-06-01");
    expect(result.map((hit) => hit.memoryId)).toEqual(["only"]);
  });

  it("相似度并列时新者优先（'最后一次'的默认时间语义）", () => {
    const fused: RankedHit[] = [
      { memoryId: "old", similarity: 0.5 },
      { memoryId: "new", similarity: 0.5 },
    ];
    const metaMap = new Map([
      ["old", meta("old", "2026-05-01T00:00:00.000Z")],
      ["new", meta("new", "2026-06-20T00:00:00.000Z")],
    ]);
    const result = rankTemporal(fused, metaMap, null, null);
    expect(result.map((hit) => hit.memoryId)).toEqual(["new", "old"]);
  });

  it("无锚定时按相似度排序，日期仅作并列裁决", () => {
    const fused: RankedHit[] = [
      { memoryId: "low", similarity: 0.4 },
      { memoryId: "high", similarity: 0.7 },
    ];
    const metaMap = new Map([
      ["low", meta("low", "2026-06-20T00:00:00.000Z")],
      ["high", meta("high", "2026-05-01T00:00:00.000Z")],
    ]);
    const result = rankTemporal(fused, metaMap, null, null);
    expect(result.map((hit) => hit.memoryId)).toEqual(["high", "low"]);
  });
});

describe("VectorRetriever temporal 路由集成", () => {
  const { databaseMock, configMock, memoryRows, vectorIndexMock } = vi.hoisted(() => ({
    configMock: {
      provider: "openai-compatible",
      baseURL: "https://api.openai.com/v1",
      apiKey: "",
      flagship: {
        model: "gpt-4o",
        maxTokens: 8192,
        temperature: 0.3,
        timeout: 60000,
        maxRetries: 3,
      },
      standard: {
        model: "gpt-4o-mini",
        maxTokens: 4096,
        temperature: 0.7,
        timeout: 30000,
        maxRetries: 2,
      },
      budget: {
        model: "gpt-4o-mini",
        maxTokens: 2048,
        temperature: 0.6,
        timeout: 15000,
        maxRetries: 1,
      },
      embedding: {
        model: "text-embedding-3-small",
        dimensions: 1536,
        maxConcurrency: 8,
        queueTimeoutMs: 60000,
      },
    },
    memoryRows: [] as Record<string, unknown>[],
    databaseMock: { exec: vi.fn(), prepare: vi.fn() },
    vectorIndexMock: { search: vi.fn(), close: vi.fn(), getBackendName: vi.fn() },
  }));

  vi.mock("../lib/storage/database", () => ({
    getDatabase: () => databaseMock,
    closeDatabase: () => undefined,
  }));
  vi.mock("../server/services/config-service", () => ({
    ConfigService: vi.fn(() => ({
      getAiConfig: vi.fn(() => configMock),
      getDefaultAiConfig: vi.fn(() => configMock),
      close: vi.fn(),
    })),
  }));
  vi.mock("../lib/vector/index", () => ({
    VectorIndex: vi.fn(() => vectorIndexMock),
  }));

  // 场景：锚定记忆 m-zustand（2026-06-01）之前的部署平台调整。
  // 干扰项 m-deploy-netlify（2026-06-20，锚定之后）相似度更高，必须被时间过滤淘汰。
  const temporalMeta = new Map<string, TemporalMeta>([
    ["m-deploy-vercel", { memoryId: "m-deploy-vercel", createdAt: "2026-05-10T00:00:00.000Z" }],
    ["m-deploy-netlify", { memoryId: "m-deploy-netlify", createdAt: "2026-06-20T00:00:00.000Z" }],
    ["m-zustand", { memoryId: "m-zustand", createdAt: "2026-06-01T00:00:00.000Z" }],
  ]);

  beforeEach(() => {
    configMock.apiKey = "test-key";
    memoryRows.length = 0;
    memoryRows.push(
      {
        id: "m-deploy-vercel",
        title: "部署平台切换记录",
        titleZh: null,
        content: "2026-05-10 部署平台从 Netlify 换到 Vercel。",
        summary: "切换到 Vercel",
        summaryZh: null,
        tags: JSON.stringify(["部署"]),
        tagsZh: null,
        topic: "infra",
        topicZh: null,
        updatedAt: "2026-05-10T00:00:00.000Z",
      },
      {
        id: "m-deploy-netlify",
        title: "Netlify 部署配置",
        titleZh: null,
        content: "2026-06-20 Netlify 域名与重定向配置。",
        summary: "Netlify 配置",
        summaryZh: null,
        tags: JSON.stringify(["部署"]),
        tagsZh: null,
        topic: "infra",
        topicZh: null,
        updatedAt: "2026-06-20T00:00:00.000Z",
      },
      {
        id: "m-zustand",
        title: "决定用 Zustand",
        titleZh: null,
        content: "2026-06-01 状态管理决定用 Zustand，替代 Redux。",
        summary: "选型 Zustand",
        summaryZh: null,
        tags: JSON.stringify(["状态管理"]),
        tagsZh: null,
        topic: "frontend",
        topicZh: null,
        updatedAt: "2026-06-01T00:00:00.000Z",
      },
    );
    databaseMock.prepare.mockImplementation((sql: string) => {
      if (sql.includes("sqlite_master")) return { get: () => ({ exists: 1 }) };
      if (sql.includes("FROM memories")) return { all: () => memoryRows };
      return { all: () => [] };
    });
    vi.spyOn(ModelAdapter, "generateEmbedding").mockResolvedValue({
      embedding: [1, 0],
      model: "test-embedding",
      timestamp: "2026-09-14T00:00:00.000Z",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("锚定之后的高相似度干扰项被时间过滤淘汰", async () => {
    vectorIndexMock.search.mockReturnValue([
      { memoryId: "m-deploy-netlify", similarity: 0.92 },
      { memoryId: "m-deploy-vercel", similarity: 0.86 },
      { memoryId: "m-zustand", similarity: 0.7 },
    ]);
    const retriever = new VectorRetriever({
      temporalMetaProvider: async (ids) => ids.map((id) => temporalMeta.get(id)!),
    });
    try {
      const response = await retriever.searchDetailed(
        "在决定用 Zustand 之前，最后一次调整部署平台是什么时候？",
        5,
      );
      expect(response.mode).toBe("temporal");
      expect(response.route).toBe("temporal");
      expect(response.results.map((r) => r.memoryId)).toEqual(["m-deploy-vercel"]);
    } finally {
      retriever.close();
    }
  });

  it("无锚定子句的时序问句按相似度排序，不做时间过滤", async () => {
    vectorIndexMock.search.mockReturnValue([
      { memoryId: "m-deploy-netlify", similarity: 0.92 },
      { memoryId: "m-deploy-vercel", similarity: 0.86 },
    ]);
    const retriever = new VectorRetriever({
      temporalMetaProvider: async (ids) => ids.map((id) => temporalMeta.get(id)!),
    });
    try {
      const response = await retriever.searchDetailed("部署平台最后一次调整是什么时候？", 5);
      expect(response.mode).toBe("temporal");
      expect(response.results.map((r) => r.memoryId)).toEqual([
        "m-deploy-netlify",
        "m-deploy-vercel",
      ]);
    } finally {
      retriever.close();
    }
  });

  it("未注入 temporalMetaProvider 时退化到常规检索（功能不缺失）", async () => {
    vectorIndexMock.search.mockReturnValue([{ memoryId: "m-deploy-vercel", similarity: 0.86 }]);
    const retriever = new VectorRetriever();
    try {
      const response = await retriever.searchDetailed("最后一次调整部署平台是什么时候？", 5);
      expect(response.route).toBe("temporal");
      expect(response.mode).toBe("vector");
      expect(response.results.map((r) => r.memoryId)).toEqual(["m-deploy-vercel"]);
    } finally {
      retriever.close();
    }
  });
});
