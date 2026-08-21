import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRecord, PendingEvent } from "../types/memory";

const pipelineState = vi.hoisted(() => {
  const writeMemoryMarkdown = vi.fn(() => Promise.resolve());
  const updateAgentMarkdown = vi.fn(() => Promise.resolve());
  const updateIndexMap = vi.fn(() => Promise.resolve());

  const now = "2026-08-07T00:00:00.000Z";
  const record: MemoryRecord = {
    id: "mem-1",
    version: 1,
    source: "chat",
    sourceType: "chat",
    title: "Pipeline memory",
    content: "remember pipeline content",
    summary: "pipeline summary",
    tags: ["pipeline"],
    topic: "uncategorized",
    createdAt: now,
    updatedAt: now,
    accessedAt: now,
    accessCount: 0,
    heatScore: 0,
    graphLinks: [],
  };

  const pending: PendingEvent[] = [];
  const stored = new Map<string, MemoryRecord>();

  return {
    now,
    record,
    pending,
    stored,
    writeMemoryMarkdown,
    updateAgentMarkdown,
    updateIndexMap,
    reset: () => {
      pending.length = 0;
      stored.clear();
      writeMemoryMarkdown.mockClear();
      updateAgentMarkdown.mockClear();
      updateIndexMap.mockClear();
    },
  };
});

vi.mock("../features/chat/handler", () => ({
  ChatHandler: vi.fn(() => ({ close: vi.fn() })),
}));

vi.mock("../features/chat/classifier", () => ({
  ChatClassifier: vi.fn(() => ({
    classify: vi.fn(() => ({
      type: "memory_create",
      confidence: 0.95,
      entities: {},
      matchedKeywords: ["remember"],
    })),
  })),
}));

vi.mock("../features/chat/extractor", () => ({
  ChatExtractor: vi.fn(() => ({
    buildMemoryRecord: vi.fn(() => pipelineState.record),
  })),
}));

vi.mock("../server/services/memory-service", () => ({
  MemoryService: vi.fn(() => ({
    stageCreateMemory: vi.fn(() => {
      pipelineState.pending.push({
        eventId: "evt-1",
        memoryId: pipelineState.record.id,
        sourceType: "chat",
        eventType: "create",
        candidate: JSON.stringify(pipelineState.record),
        changedFields: Object.keys(pipelineState.record),
        createdAt: pipelineState.now,
        status: "pending",
        retryCount: 0,
      });
      return pipelineState.record.id;
    }),
    getPendingEvents: vi.fn(() => pipelineState.pending),
    getMemory: vi.fn((id: string) => pipelineState.stored.get(id) ?? null),
    createMemoryRecord: vi.fn(async (record: MemoryRecord) => {
      pipelineState.stored.set(record.id, record);
      return record.id;
    }),
    listMemories: vi.fn(() => Array.from(pipelineState.stored.values())),
    classifyMemory: vi.fn(),
    updateEvent: vi.fn(),
    close: vi.fn(),
  })),
}));

vi.mock("../server/services/quality-filter-service", () => ({
  QualityFilterService: vi.fn(() => ({ filter: vi.fn(() => Promise.resolve({ ok: true })) })),
}));

vi.mock("../server/services/audit-service", () => ({
  AuditService: vi.fn(() => ({ createConflict: vi.fn(), close: vi.fn() })),
}));

vi.mock("../features/audit/auditor", () => ({
  Auditor: vi.fn(() => ({ process: vi.fn(), close: vi.fn() })),
}));

vi.mock("../features/audit/reporter", () => ({
  AuditReporter: vi.fn(() => ({
    generateMarkdownReport: vi.fn(() => Promise.resolve("# Audit")),
    close: vi.fn(),
  })),
}));

vi.mock("../lib/storage/memory-writer", () => ({
  writeMemoryMarkdown: pipelineState.writeMemoryMarkdown,
  updateAgentMarkdown: pipelineState.updateAgentMarkdown,
}));

vi.mock("../lib/storage/index-writer", () => ({
  updateIndexMap: pipelineState.updateIndexMap,
}));

vi.mock("../lib/storage/file-manager", () => ({
  createFailureRecord: vi.fn(() => Promise.resolve()),
}));

vi.mock("../lib/storage/path-resolver", () => ({
  getArchivePath: () => "archive",
}));

vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  return {
    ...actual,
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
  };
});

import { AgentDispatcher } from "../features/agent/dispatcher";
import { Orchestrator } from "../server/services/orchestrator";

describe("chat to memory writeback pipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pipelineState.reset();
  });

  it("routes a memory-create chat message into audit queue and writes Markdown on processing", async () => {
    const dispatcher = new AgentDispatcher();

    const dispatchResult = await dispatcher.dispatch(
      [{ role: "user", content: "remember pipeline content" }],
      "memory",
      "sess-1",
    );

    if (dispatchResult.type !== "json") {
      throw new Error("Expected memory-create dispatch to return a JSON result");
    }
    expect(dispatchResult.data.memoryId).toBe("mem-1");
    expect(pipelineState.pending).toHaveLength(1);
    expect(pipelineState.pending[0]).toMatchObject({
      eventId: "evt-1",
      memoryId: "mem-1",
      status: "pending",
    });

    const orchestrator = new Orchestrator();
    await orchestrator.processQueue();

    expect(pipelineState.writeMemoryMarkdown).toHaveBeenCalledWith(
      expect.objectContaining({ id: "mem-1", title: "Pipeline memory" }),
    );
    expect(pipelineState.updateAgentMarkdown).toHaveBeenCalledWith("uncategorized", [
      expect.objectContaining({ id: "mem-1" }),
    ]);
    expect(pipelineState.updateIndexMap).toHaveBeenCalled();
    expect(pipelineState.pending[0].status).toBe("done");
  });
});
