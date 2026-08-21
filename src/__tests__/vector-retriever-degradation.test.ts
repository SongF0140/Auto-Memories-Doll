import { beforeEach, describe, expect, it, vi } from "vitest";

const { databaseMock, configMock, memoryRows } = vi.hoisted(() => ({
  configMock: {
    provider: "openai-compatible",
    baseURL: "https://api.openai.com/v1",
    apiKey: "",
    flagship: { model: "gpt-4o", maxTokens: 8192, temperature: 0.3, timeout: 60000, maxRetries: 3 },
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
  databaseMock: {
    exec: vi.fn(),
    prepare: vi.fn(),
  },
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

import { ModelAdapter } from "../lib/ai/model-adapter";
import { VectorRetriever } from "../lib/vector/retriever";

beforeEach(() => {
  memoryRows.length = 0;
  databaseMock.exec.mockReset();
  databaseMock.prepare.mockReset();
  databaseMock.prepare.mockImplementation((sql: string) => {
    if (sql.includes("sqlite_master")) {
      return { get: () => ({ exists: 1 }) };
    }
    if (sql.includes("FROM memories")) {
      return { all: () => memoryRows };
    }
    return { all: () => [] };
  });
});

describe("VectorRetriever keyword degradation", () => {
  it("falls back to keyword recall when no API key is configured", async () => {
    memoryRows.push(
      {
        id: "memory-keyword",
        title: "Offline search",
        titleZh: "离线检索方案",
        content: "Embedding 失效时仍然可以搜索本地记忆。",
        summary: "关键词降级",
        summaryZh: null,
        tags: JSON.stringify(["fallback", "本地搜索"]),
        tagsZh: null,
        topic: "ai-coding",
        topicZh: null,
        updatedAt: "2026-08-21T00:00:00.000Z",
      },
      {
        id: "memory-unrelated",
        title: "旅行计划",
        titleZh: null,
        content: "周末徒步路线",
        summary: "准备户外用品",
        summaryZh: null,
        tags: JSON.stringify(["旅行"]),
        tagsZh: null,
        topic: "daily-notes",
        topicZh: null,
        updatedAt: "2026-08-20T00:00:00.000Z",
      },
    );

    const retriever = new VectorRetriever();
    try {
      const response = await retriever.searchDetailed("离线检索", 10);

      expect(ModelAdapter.isDegradedMode).toBe(true);
      expect(response.mode).toBe("keyword");
      expect(response.results).toEqual([expect.objectContaining({ memoryId: "memory-keyword" })]);
    } finally {
      retriever.close();
    }
  });
});
