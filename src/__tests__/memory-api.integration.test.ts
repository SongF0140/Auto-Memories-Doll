import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const memoryServiceMock = vi.hoisted(() => ({
  listMemories: vi.fn(),
  count: vi.fn(),
  getMemory: vi.fn(),
  getMemoriesByIds: vi.fn(),
  listClassifications: vi.fn(),
  close: vi.fn(),
}));

const vectorRetrieverMock = vi.hoisted(() => ({
  search: vi.fn(),
  searchDetailed: vi.fn(),
  close: vi.fn(),
}));

const orchestratorMock = vi.hoisted(() => ({
  processIngest: vi.fn(),
  close: vi.fn(),
}));

vi.mock("../server/services/memory-service", () => ({
  MemoryService: vi.fn(() => memoryServiceMock),
}));

vi.mock("../lib/vector/retriever", () => ({
  VectorRetriever: vi.fn(() => vectorRetrieverMock),
}));

vi.mock("../server/services/orchestrator", () => ({
  Orchestrator: vi.fn(() => orchestratorMock),
}));

import { GET as listMemories } from "../app/api/memory/route";
import { GET as searchMemories } from "../app/api/memory/search/route";
import { POST as ingestMemories } from "../app/api/ingest/route";

const memory = {
  id: "memory-1",
  version: 1,
  source: "test",
  sourceType: "manual",
  title: "测试记忆",
  content: "测试内容",
  summary: "测试摘要",
  tags: ["test"],
  topic: "uncategorized",
  createdAt: "2026-08-21T00:00:00.000Z",
  updatedAt: "2026-08-21T00:00:00.000Z",
  accessedAt: "2026-08-21T00:00:00.000Z",
  accessCount: 0,
  heatScore: 0,
  graphLinks: [],
};

function jsonRequest(url: string, method: "GET" | "POST", body?: unknown): NextRequest {
  return new NextRequest(url, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function responseJson(response: Response): Promise<any> {
  return response.json();
}

describe("memory list/search/ingest HTTP contracts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    memoryServiceMock.listMemories.mockReturnValue([memory]);
    memoryServiceMock.count.mockReturnValue(1);
    memoryServiceMock.getMemory.mockReturnValue(memory);
    memoryServiceMock.getMemoriesByIds.mockReturnValue([memory]);
    memoryServiceMock.listClassifications.mockReturnValue([]);
    vectorRetrieverMock.search.mockResolvedValue([{ memoryId: memory.id, similarity: 0.92 }]);
    vectorRetrieverMock.searchDetailed.mockResolvedValue({
      results: [{ memoryId: memory.id, similarity: 0.92 }],
      mode: "vector",
    });
    orchestratorMock.processIngest.mockResolvedValue("event-1");
  });

  it("GET /api/memory exposes the list under data.items", async () => {
    const response = await listMemories(
      jsonRequest("http://localhost/api/memory?page=2&pageSize=1", "GET"),
    );

    expect(response.status).toBe(200);
    await expect(responseJson(response)).resolves.toEqual({
      success: true,
      data: {
        items: [memory],
        total: 1,
        page: 2,
        pageSize: 1,
      },
    });
  });

  it("GET /api/memory/search exposes the list under data.results", async () => {
    const response = await searchMemories(
      jsonRequest("http://localhost/api/memory/search?q=test", "GET"),
    );

    expect(response.status).toBe(200);
    const body = await responseJson(response);
    expect(body.success).toBe(true);
    expect(body.data.results).toEqual([expect.objectContaining(memory)]);
    expect(body.data.total).toBe(1);
    expect(body.data.retrievalMode).toBe("vector");
    expect(body.data.degradedMode).toBe(false);
  });

  it("GET /api/memory/search exposes keyword degradation mode", async () => {
    vectorRetrieverMock.searchDetailed.mockResolvedValue({
      results: [{ memoryId: memory.id, similarity: 0.6 }],
      mode: "keyword",
    });

    const response = await searchMemories(
      jsonRequest("http://localhost/api/memory/search?q=test", "GET"),
    );
    const body = await responseJson(response);

    expect(response.status).toBe(200);
    expect(body.data.retrievalMode).toBe("keyword");
    expect(body.data.degradedMode).toBe(true);
  });

  it("GET /api/memory/search batch-loads matching memories", async () => {
    const memories = ["memory-1", "memory-2", "memory-3"].map((id) => ({ ...memory, id }));
    vectorRetrieverMock.searchDetailed.mockResolvedValue({
      results: memories.map((item) => ({ memoryId: item.id, similarity: 0.9 })),
      mode: "vector",
    });
    memoryServiceMock.getMemory.mockImplementation(() => {
      throw new Error("search route must not perform N+1 getMemory calls");
    });
    memoryServiceMock.getMemoriesByIds.mockReturnValue(memories);

    const response = await searchMemories(
      jsonRequest("http://localhost/api/memory/search?q=test&limit=3", "GET"),
    );
    const body = await responseJson(response);

    expect(response.status).toBe(200);
    expect(memoryServiceMock.getMemoriesByIds).toHaveBeenCalledWith([
      "memory-1",
      "memory-2",
      "memory-3",
    ]);
    expect(memoryServiceMock.getMemory).not.toHaveBeenCalled();
    expect(body.data.results.map((item: typeof memory) => item.id)).toEqual([
      "memory-1",
      "memory-2",
      "memory-3",
    ]);
  });

  it("GET /api/memory/search parses limit as base 10", async () => {
    await searchMemories(
      jsonRequest("http://localhost/api/memory/search?q=test&limit=08", "GET"),
    );

    expect(vectorRetrieverMock.searchDetailed).toHaveBeenCalledWith("test", 8, 0.3);
  });

  it("POST /api/ingest returns the queued event inside data", async () => {
    const response = await ingestMemories(
      jsonRequest("http://localhost/api/ingest", "POST", {
        content: "需要导入的内容",
        format: "text",
      }),
    );

    expect(response.status).toBe(200);
    await expect(responseJson(response)).resolves.toEqual({
      success: true,
      data: { eventId: "event-1", status: "queued" },
    });
  });

  it("returns the same error envelope for invalid ingest JSON", async () => {
    const response = await ingestMemories(
      new NextRequest("http://localhost/api/ingest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      }),
    );

    expect(response.status).toBe(400);
    await expect(responseJson(response)).resolves.toMatchObject({
      success: false,
      error: {
        code: "INVALID_JSON",
      },
    });
  });

  it("returns the same error envelope for a missing search query", async () => {
    const response = await searchMemories(jsonRequest("http://localhost/api/memory/search", "GET"));

    expect(response.status).toBe(400);
    await expect(responseJson(response)).resolves.toMatchObject({
      success: false,
      error: {
        code: "VALIDATION_FAILED",
      },
    });
  });
});
