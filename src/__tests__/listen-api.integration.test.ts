import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const processorMock = vi.hoisted(() => ({
  formatConversation: vi.fn(),
  generateKnowledgeCard: vi.fn(),
}));

const memoryServiceMock = vi.hoisted(() => ({
  stageCreateMemory: vi.fn(),
  close: vi.fn(),
}));

const listenStatsDbRef = vi.hoisted(() => ({
  current: null as import("better-sqlite3").Database | null,
}));

vi.mock("../features/ingest/conversation-processor", () => ({
  ConversationProcessor: vi.fn(() => processorMock),
}));

vi.mock("../server/services/memory-service", () => ({
  MemoryService: vi.fn(() => memoryServiceMock),
}));

vi.mock("../lib/storage/database", async () => {
  type BetterSqlite3Module = typeof import("better-sqlite3") & {
    default?: typeof import("better-sqlite3");
  };
  const actual = await vi.importActual<BetterSqlite3Module>("better-sqlite3");
  const Database = actual.default ?? actual;
  listenStatsDbRef.current = new Database(":memory:");

  return {
    getDatabase: () => listenStatsDbRef.current,
  };
});

vi.mock("../lib/storage/path-resolver", () => ({
  getNotePath: (topic: string, memoryId: string) => `/memory-root/notes/${topic}/${memoryId}.md`,
}));

import { POST } from "../app/api/listen/route";

beforeEach(() => {
  vi.clearAllMocks();
  listenStatsDbRef.current?.exec("DROP TABLE IF EXISTS listen_stats");
  processorMock.formatConversation.mockReturnValue({
    title: "监听标题",
    content: "监听正文",
    topic: "ai-coding",
  });
  processorMock.generateKnowledgeCard.mockReturnValue({
    title: "监听标题",
    summary: "监听摘要",
    tags: ["listen"],
    topic: "ai-coding",
  });
  memoryServiceMock.stageCreateMemory.mockReturnValue("stable-listen-id");
});

describe("POST /api/listen", () => {
  it("queues one candidate and returns its eventual canonical Markdown path", async () => {
    const request = new NextRequest("http://localhost/api/listen", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source: "browser",
        messages: [{ role: "user", content: "记录这段对话" }],
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(memoryServiceMock.stageCreateMemory).toHaveBeenCalledTimes(1);
    expect(body.memoryId).toBe("stable-listen-id");
    expect(body.filePath).toBe("/memory-root/notes/ai-coding/stable-listen-id.md");
  });

  it("keeps listener stats after the route module is reloaded", async () => {
    const request = new NextRequest("http://localhost/api/listen", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source: "browser",
        messages: [{ role: "user", content: "记录这段对话" }],
      }),
    });

    await POST(request);
    vi.resetModules();
    const reloaded = await import("../app/api/listen/route");
    const response = await reloaded.GET();
    const body = await response.json();

    expect(body.stats.totalReceived).toBeGreaterThanOrEqual(1);
    expect(body.stats.sources.browser).toBeGreaterThanOrEqual(1);
  });

  it("rejects oversized request bodies before processing", async () => {
    const request = new NextRequest("http://localhost/api/listen", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": "2000000",
      },
      body: JSON.stringify({
        source: "browser",
        messages: [{ role: "user", content: "记录这段对话" }],
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(413);
    expect(body.success).toBe(false);
    expect(memoryServiceMock.stageCreateMemory).not.toHaveBeenCalled();
  });

  it("rejects message batches above the listen limit", async () => {
    const request = new NextRequest("http://localhost/api/listen", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source: "browser",
        messages: Array.from({ length: 201 }, (_, index) => ({
          role: index % 2 === 0 ? "user" : "assistant",
          content: `message ${index}`,
        })),
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.success).toBe(false);
    expect(memoryServiceMock.stageCreateMemory).not.toHaveBeenCalled();
  });
});
