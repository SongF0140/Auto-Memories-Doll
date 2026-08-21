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

vi.mock("../features/ingest/conversation-processor", () => ({
  ConversationProcessor: vi.fn(() => processorMock),
}));

vi.mock("../server/services/memory-service", () => ({
  MemoryService: vi.fn(() => memoryServiceMock),
}));

vi.mock("../lib/storage/path-resolver", () => ({
  getNotePath: (topic: string, memoryId: string) => `/memory-root/notes/${topic}/${memoryId}.md`,
}));

import { POST } from "../app/api/listen/route";

beforeEach(() => {
  vi.clearAllMocks();
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
});
