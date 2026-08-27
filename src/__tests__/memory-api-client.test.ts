import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getMemoryClient,
  listMemoriesClient,
  memoryDetailHref,
  memoryTopicHref,
  searchMemoriesClient,
} from "../lib/memory-api-client";
import type { MemoryRecord } from "../types/memory";

const memory: MemoryRecord = {
  id: "memory / 1",
  version: 1,
  source: "test",
  sourceType: "manual",
  title: "测试记忆",
  content: "测试内容",
  summary: "测试摘要",
  tags: ["test"],
  topic: "project notes",
  createdAt: "2026-08-27T00:00:00.000Z",
  updatedAt: "2026-08-27T00:00:00.000Z",
  accessedAt: "2026-08-27T00:00:00.000Z",
  accessCount: 0,
  heatScore: 0,
  graphLinks: [],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("memory browser API client", () => {
  it("reads the memory library from data.items", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        success: true,
        data: { items: [memory], total: 1, page: 1, pageSize: 100 },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const data = await listMemoriesClient(500);

    expect(data.items).toEqual([memory]);
    expect(fetchMock).toHaveBeenCalledWith("/api/memory?pageSize=100", undefined);
  });

  it("keeps pagination and topic filters in the list query", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        success: true,
        data: { items: [memory], total: 1, page: 2, pageSize: 12 },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await listMemoriesClient(12, 2, "ai-coding");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/memory?page=2&pageSize=12&topic=ai-coding",
      undefined,
    );
  });

  it("reads semantic search results from data.results and uses the limit contract", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        success: true,
        data: {
          results: [memory],
          total: 1,
          retrievalMode: "vector",
          degradedMode: false,
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const data = await searchMemoriesClient("  测试 查询  ", 10);

    expect(data.results).toEqual([memory]);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/memory/search?q=%E6%B5%8B%E8%AF%95%20%E6%9F%A5%E8%AF%A2&limit=10",
      undefined,
    );
  });

  it("does not issue a request for an empty search", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(searchMemoriesClient("   ")).rejects.toThrow("搜索内容不能为空");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps memory ids and topics on separate route namespaces", () => {
    expect(memoryDetailHref(memory.id)).toBe("/memory/memory%20%2F%201");
    expect(memoryTopicHref(memory.topic)).toBe("/memory/topic/project%20notes");
  });

  it("loads a detail record by memory id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(memory));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getMemoryClient(memory.id)).resolves.toEqual(memory);
    expect(fetchMock).toHaveBeenCalledWith("/api/memory/memory%20%2F%201", {
      signal: undefined,
    });
  });
});
