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

const loggerMock = vi.hoisted(() => ({
  error: vi.fn(),
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

vi.mock("../lib/logger", () => ({
  logger: { api: loggerMock },
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

function jsonRequest(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function rawRequest(url: string, body: string, headers: Record<string, string> = {}) {
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });
}

async function expectError(response: Response, status: number, code: string, message?: string) {
  expect(response.status).toBe(status);
  await expect(response.json()).resolves.toMatchObject({
    success: false,
    error: {
      code,
      ...(message ? { message } : {}),
    },
  });
}

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
  loggerMock.error.mockReset();
});

describe("POST /api/listen", () => {
  it("queues one candidate and returns its eventual canonical Markdown path", async () => {
    const response = await POST(
      jsonRequest("http://localhost/api/listen", {
        source: "browser",
        messages: [{ role: "user", content: "记录这段对话" }],
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(memoryServiceMock.stageCreateMemory).toHaveBeenCalledTimes(1);
    expect(memoryServiceMock.stageCreateMemory).toHaveBeenCalledWith(
      "browser",
      "listen",
      "监听标题",
      "监听正文",
      "监听摘要",
      ["listen"],
      "ai-coding",
      {
        titleZh: undefined,
        summaryZh: "监听摘要",
        tagsZh: undefined,
        topicZh: undefined,
      },
    );
    expect(body.memoryId).toBe("stable-listen-id");
    expect(body.filePath).toBe("/memory-root/notes/ai-coding/stable-listen-id.md");
  });

  it("keeps listener stats after the route module is reloaded", async () => {
    await POST(
      jsonRequest("http://localhost/api/listen", {
        source: "browser",
        messages: [{ role: "user", content: "记录这段对话" }],
      }),
    );
    vi.resetModules();
    const reloaded = await import("../app/api/listen/route");
    const response = await reloaded.GET();
    const body = await response.json();

    expect(body.stats.totalReceived).toBeGreaterThanOrEqual(1);
    expect(body.stats.sources.browser).toBeGreaterThanOrEqual(1);
  });

  it("returns INVALID_JSON for malformed JSON", async () => {
    const response = await POST(rawRequest("http://localhost/api/listen", "{"));

    await expectError(response, 400, "INVALID_JSON", "请求体不是有效 JSON");
    expect(memoryServiceMock.stageCreateMemory).not.toHaveBeenCalled();
  });

  it("returns VALIDATION_FAILED for an empty object", async () => {
    const response = await POST(jsonRequest("http://localhost/api/listen", {}));

    await expectError(response, 400, "VALIDATION_FAILED");
    expect(memoryServiceMock.stageCreateMemory).not.toHaveBeenCalled();
  });

  it("returns VALIDATION_FAILED when source is missing", async () => {
    const response = await POST(
      jsonRequest("http://localhost/api/listen", {
        messages: [{ role: "user", content: "内容" }],
      }),
    );

    await expectError(response, 400, "VALIDATION_FAILED", "source 不能为空");
    expect(memoryServiceMock.stageCreateMemory).not.toHaveBeenCalled();
  });

  it("returns VALIDATION_FAILED for empty messages", async () => {
    const response = await POST(
      jsonRequest("http://localhost/api/listen", { source: "browser", messages: [] }),
    );

    await expectError(response, 400, "VALIDATION_FAILED", "messages 至少需要一条消息");
    expect(memoryServiceMock.stageCreateMemory).not.toHaveBeenCalled();
  });

  it("rejects oversized request bodies before processing", async () => {
    const response = await POST(
      jsonRequest(
        "http://localhost/api/listen",
        { source: "browser", messages: [{ role: "user", content: "记录这段对话" }] },
        { "content-length": "2000000" },
      ),
    );

    await expectError(response, 413, "VALIDATION_FAILED", "请求体不能超过 1000000 bytes");
    expect(memoryServiceMock.stageCreateMemory).not.toHaveBeenCalled();
  });

  it("rejects message batches above the listen limit", async () => {
    const response = await POST(
      jsonRequest("http://localhost/api/listen", {
        source: "browser",
        messages: Array.from({ length: 201 }, (_, index) => ({
          role: index % 2 === 0 ? "user" : "assistant",
          content: `message ${index}`,
        })),
      }),
    );

    await expectError(response, 400, "VALIDATION_FAILED");
    expect(memoryServiceMock.stageCreateMemory).not.toHaveBeenCalled();
  });

  it("returns a stable internal error without exposing processor details", async () => {
    processorMock.formatConversation.mockImplementationOnce(() => {
      throw new Error("sensitive processor detail");
    });

    const response = await POST(
      jsonRequest("http://localhost/api/listen", {
        source: "browser",
        messages: [{ role: "user", content: "记录这段对话" }],
      }),
    );

    await expectError(response, 500, "INTERNAL_ERROR", "监听请求处理失败");
    expect(loggerMock.error).toHaveBeenCalledWith(
      "POST /api/listen 处理失败",
      expect.objectContaining({ message: "sensitive processor detail" }),
    );
    expect(memoryServiceMock.stageCreateMemory).not.toHaveBeenCalled();
  });

  it("rejects a body that exceeds the limit after reading it", async () => {
    const oversizedBody = JSON.stringify({
      source: "browser",
      messages: [{ role: "user", content: "x".repeat(1_000_010) }],
    });
    const response = await POST(rawRequest("http://localhost/api/listen", oversizedBody));

    await expectError(response, 413, "VALIDATION_FAILED");
    expect(memoryServiceMock.stageCreateMemory).not.toHaveBeenCalled();
  });
});
