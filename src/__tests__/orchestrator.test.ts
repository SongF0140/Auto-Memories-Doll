import { describe, it, expect, vi, beforeEach } from "vitest";

// ── mock: processJsonPipeline ──
const pipelineMock = vi.hoisted(() => ({
  pipelineResult: {
    isDuplicate: false,
    similarity: 0,
    chunks: [{ content: "cleaned content", summary: "pipe-summary", tags: ["pipe-tag"] }],
  },
}));

vi.mock("../server/pipelines/json-pipeline", () => ({
  processJsonPipeline: vi.fn(() => Promise.resolve(pipelineMock.pipelineResult)),
}));

// ── mock: memory builder/validator ──
const builderMock = vi.hoisted(() => {
  const record = {
    id: "test-id",
    source: "test",
    sourceType: "ingest",
    title: "test title",
    content: "test content",
    summary: "test summary",
    tags: ["a"],
    topic: "uncategorized",
    graphLinks: [],
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    version: 2,
  };
  return {
    memoryRecord: record,
    pendingEvent: {
      eventId: "evt-1",
      memoryId: "test-id",
      eventType: "ingest",
      candidate: JSON.stringify(record),
      changedFields: [],
      status: "pending",
      createdAt: "2026-01-01",
    },
    validatorResult: true,
  };
});

vi.mock("../lib/memory/builder", () => ({
  buildMemoryRecord: vi.fn(
    (
      source: string,
      sourceType: string,
      title: string,
      content: string,
      summary: string,
      tags: string[],
    ) => ({
      id: "test-id",
      source,
      sourceType,
      title,
      content,
      summary,
      tags,
      topic: "uncategorized",
      graphLinks: [],
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
      version: 2,
    }),
  ),
  buildPendingEvent: vi.fn((id: string, sourceType: string, memory: any) => ({
    eventId: "evt-1",
    memoryId: id,
    eventType: sourceType,
    candidate: JSON.stringify(memory),
    changedFields: Object.keys(memory),
    status: "pending" as const,
    createdAt: "2026-01-01",
  })),
}));

vi.mock("../lib/memory/validator", () => ({
  validateMemoryRecord: vi.fn(() => builderMock.validatorResult),
}));

// ── mock: filesystem ──
vi.mock("fs", () => ({
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock("path", async () => {
  const actual = await vi.importActual("path");
  return { ...actual, join: (...args: string[]) => args.join("/") };
});

// ── mock: path-resolver ──
vi.mock("../lib/storage/path-resolver", () => ({
  getArchivePath: () => "/fake/archive",
  getNotePath: (topic: string, id: string) => `/fake/notes/${topic}/${id}.md`,
}));

// ── mock: index-writer ──
vi.mock("../lib/storage/index-writer", () => ({
  updateIndexMap: vi.fn(() => Promise.resolve()),
}));

// ── mock: memory-writer ──
vi.mock("../lib/storage/memory-writer", () => ({
  writeMemoryMarkdown: vi.fn(() => Promise.resolve()),
  updateAgentMarkdown: vi.fn(() => Promise.resolve()),
}));

// ── mock: file-manager ──
vi.mock("../lib/storage/file-manager", () => ({
  createFailureRecord: vi.fn(() => Promise.resolve()),
  deleteFile: vi.fn(() => Promise.resolve()),
}));

// ── mock: vector/generator ──
vi.mock("../lib/vector/generator", () => ({
  buildVectorRecord: vi.fn((id: string) =>
    Promise.resolve({
      memoryId: id,
      embedding: [0.1],
      model: "test",
      dimensions: 1,
      updatedAt: "2026-01-01",
    }),
  ),
}));

// ── mock: model-adapter（recallSimilarMemories 依赖） ──
vi.mock("../lib/ai/model-adapter", () => ({
  ModelAdapter: {
    isDegradedMode: false,
    generateEmbedding: vi.fn(() =>
      Promise.resolve({ embedding: [0.1], model: "test", timestamp: "2026-01-01" }),
    ),
  },
}));

// ── mock: VectorIndex ──
const vectorIndexCreate = vi.fn();
const vectorIndexClose = vi.fn();
const vectorIndexSearch = vi.fn(() => [] as Array<{ memoryId: string; similarity: number }>);
vi.mock("../lib/vector/index", () => ({
  VectorIndex: vi.fn(() => ({
    create: vectorIndexCreate,
    close: vectorIndexClose,
    search: vectorIndexSearch,
  })),
}));

// ── mock: services ──
let memoryServiceStub: ReturnType<typeof createMemoryServiceStub>;

function createMemoryServiceStub() {
  return {
    getMemory: vi.fn(),
    createMemory: vi.fn(),
    createMemoryRecord: vi.fn(),
    updateMemory: vi.fn(),
    setVectorId: vi.fn(),
    deleteMemory: vi.fn(),
    listMemories: vi.fn(),
    listMemoryContents: vi.fn(),
    enqueueEvent: vi.fn(),
    dequeueEvent: vi.fn(),
    getPendingEvents: vi.fn(),
    getEvent: vi.fn(),
    updateEvent: vi.fn(),
    classifyMemory: vi.fn(),
    count: vi.fn(() => 0),
    close: vi.fn(),
  };
}

let auditServiceStub: ReturnType<typeof createAuditServiceStub>;

function createAuditServiceStub() {
  return {
    createConflict: vi.fn(),
    getConflict: vi.fn(),
    markConflictResolved: vi.fn(),
    close: vi.fn(),
  };
}

vi.mock("../server/services/audit-service", () => ({
  AuditService: vi.fn(() => auditServiceStub),
}));

const createSnapshotMock = vi.fn();
vi.mock("../features/audit/version-manager", () => ({
  VersionManager: vi.fn(() => ({
    getSnapshot: vi.fn(() => null),
    createSnapshot: createSnapshotMock,
    close: vi.fn(),
  })),
}));

const auditorProcessMock = vi.fn();
const auditorCloseMock = vi.fn();
vi.mock("../features/audit/auditor", () => ({
  Auditor: vi.fn(() => ({
    process: auditorProcessMock,
    close: auditorCloseMock,
  })),
}));

const qualityFilterMock = vi.fn();
vi.mock("../server/services/quality-filter-service", () => ({
  QualityFilterService: vi.fn(() => ({ filter: qualityFilterMock })),
}));

vi.mock("../features/audit/reporter", () => ({
  AuditReporter: vi.fn(() => ({
    generateMarkdownReport: vi.fn(() => Promise.resolve("# Audit Report")),
    close: vi.fn(),
  })),
}));

// ── 实际导入被测试类 ──
import { Orchestrator } from "../server/services/orchestrator";
import { MemoryValidationError } from "../lib/errors";

vi.mock("../server/services/memory-service", () => ({
  MemoryService: vi.fn(function (this: any) {
    return memoryServiceStub;
  }),
}));

describe("Orchestrator", () => {
  let orchestrator: Orchestrator;

  beforeEach(() => {
    vi.clearAllMocks();
    memoryServiceStub = createMemoryServiceStub();
    auditServiceStub = createAuditServiceStub();
    // 重置 pipeline mock
    pipelineMock.pipelineResult = {
      isDuplicate: false,
      similarity: 0,
      chunks: [{ content: "cleaned content", summary: "pipe-summary", tags: ["pipe-tag"] }],
    };
    builderMock.validatorResult = true;
    qualityFilterMock.mockResolvedValue({ verdict: "accept", score: 8, kind: "fact" });
    vectorIndexSearch.mockReturnValue([]);
    auditorProcessMock.mockResolvedValue(null);
    memoryServiceStub.listMemoryContents.mockReturnValue([]);
    orchestrator = new Orchestrator();
  });

  describe("resolveConflict", () => {
    it("接受候选内容后真正更新记忆正文并同步派生存储", async () => {
      let stored = {
        ...builderMock.memoryRecord,
        content: "旧正文",
        accessedAt: "2026-01-01",
        accessCount: 0,
        heatScore: 0,
        vectorId: "test-id",
      } as any;
      auditServiceStub.getConflict.mockReturnValue({
        conflictId: "conflict-1",
        memoryId: stored.id,
        eventId: "evt-1",
        field: "content",
        existingValue: JSON.stringify("旧正文"),
        candidateValue: JSON.stringify("候选正文"),
        status: "pending",
        createdAt: "2026-01-01",
      });
      memoryServiceStub.getMemory.mockImplementation(() => stored);
      memoryServiceStub.updateMemory.mockImplementation((_id, updates) => {
        stored = { ...stored, ...updates, version: stored.version + 1 };
      });
      memoryServiceStub.listMemories.mockImplementation(() => [stored]);

      const result = await orchestrator.resolveConflict("conflict-1", "accept");

      expect(result.content).toBe("候选正文");
      expect(stored.content).toBe("候选正文");
      expect(createSnapshotMock).toHaveBeenCalledWith(
        expect.objectContaining({ content: "旧正文" }),
        2,
      );
      expect(memoryServiceStub.setVectorId).toHaveBeenCalledWith(stored.id, stored.id);
      expect(memoryServiceStub.classifyMemory).toHaveBeenCalledWith(stored.id, "候选正文");
      expect(auditServiceStub.markConflictResolved).toHaveBeenCalledWith(
        "conflict-1",
        "accept",
        undefined,
      );

      const memoryWriter = await import("../lib/storage/memory-writer");
      expect(memoryWriter.writeMemoryMarkdown).toHaveBeenCalledWith(
        expect.objectContaining({ content: "候选正文" }),
      );
      expect(memoryWriter.updateAgentMarkdown).toHaveBeenCalled();
      const indexWriter = await import("../lib/storage/index-writer");
      expect(indexWriter.updateIndexMap).toHaveBeenCalledWith([
        expect.objectContaining({ content: "候选正文" }),
      ]);
    });

    it("保留现有值时不改正文，但仍完成投影同步后标记解决", async () => {
      const stored = {
        ...builderMock.memoryRecord,
        content: "保留正文",
        accessedAt: "2026-01-01",
        accessCount: 0,
        heatScore: 0,
      } as any;
      auditServiceStub.getConflict.mockReturnValue({
        conflictId: "conflict-keep",
        memoryId: stored.id,
        eventId: "evt-keep",
        field: "content",
        existingValue: JSON.stringify("保留正文"),
        candidateValue: JSON.stringify("候选正文"),
        status: "pending",
        createdAt: "2026-01-01",
      });
      memoryServiceStub.getMemory.mockReturnValue(stored);
      memoryServiceStub.listMemories.mockReturnValue([stored]);

      const result = await orchestrator.resolveConflict("conflict-keep", "keep");

      expect(result.content).toBe("保留正文");
      expect(memoryServiceStub.updateMemory).not.toHaveBeenCalled();
      expect(auditServiceStub.markConflictResolved).toHaveBeenCalledWith(
        "conflict-keep",
        "keep",
        undefined,
      );
    });

    it("手动编辑会写入人工值", async () => {
      let stored = {
        ...builderMock.memoryRecord,
        title: "原标题",
        accessedAt: "2026-01-01",
        accessCount: 0,
        heatScore: 0,
      } as any;
      auditServiceStub.getConflict.mockReturnValue({
        conflictId: "conflict-manual",
        memoryId: stored.id,
        eventId: "evt-manual",
        field: "title",
        existingValue: JSON.stringify("原标题"),
        candidateValue: JSON.stringify("候选标题"),
        status: "pending",
        createdAt: "2026-01-01",
      });
      memoryServiceStub.getMemory.mockImplementation(() => stored);
      memoryServiceStub.updateMemory.mockImplementation((_id, updates) => {
        stored = { ...stored, ...updates, version: stored.version + 1 };
      });
      memoryServiceStub.listMemories.mockImplementation(() => [stored]);

      const result = await orchestrator.resolveConflict("conflict-manual", "manual", "人工标题");

      expect(result.title).toBe("人工标题");
      expect(auditServiceStub.markConflictResolved).toHaveBeenCalledWith(
        "conflict-manual",
        "manual",
        "人工标题",
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // processIngest
  // ═══════════════════════════════════════════════════════════════

  describe("processIngest", () => {
    it("成功：完整预处理管线 → 构建记录 → 校验 → 入队，返回 eventId", async () => {
      memoryServiceStub.listMemories.mockReturnValue([]);
      memoryServiceStub.listMemoryContents.mockReturnValue([]);

      const eventId = await orchestrator.processIngest(
        "test-source",
        "ingest",
        "raw content",
        "My Title",
        "My Summary",
        ["tag1"],
      );

      expect(eventId).toBe("evt-1");
      expect(memoryServiceStub.enqueueEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventId: "evt-1", memoryId: expect.any(String) }),
      );
      expect(memoryServiceStub.listMemoryContents).toHaveBeenCalledWith(
        expect.objectContaining({ limit: expect.any(Number), offset: 0 }),
      );
      expect(memoryServiceStub.listMemories).not.toHaveBeenCalled();
    });

    it("分页扫描去重候选，不一次性加载全量正文", async () => {
      memoryServiceStub.listMemories.mockReturnValue([]);
      memoryServiceStub.count.mockReturnValue(5);
      memoryServiceStub.listMemoryContents.mockImplementation(
        (opts?: { limit?: number; offset?: number }) => {
          if (!opts) {
            return ["alpha", "beta", "gamma", "raw content", "delta"];
          }

          if (opts.offset === 0) return ["alpha", "beta"];
          if (opts.offset === 2) return ["gamma", "raw content"];
          return [];
        },
      );

      await expect(
        orchestrator.processIngest(
          "test-source",
          "ingest",
          "raw content",
          "My Title",
          "My Summary",
          ["tag1"],
        ),
      ).rejects.toBeInstanceOf(MemoryValidationError);

      expect(
        memoryServiceStub.listMemoryContents.mock.calls.every(([arg]) =>
          Boolean(arg && typeof arg.limit === "number" && typeof arg.offset === "number"),
        ),
      ).toBe(true);
      expect(memoryServiceStub.listMemoryContents).toHaveBeenCalledTimes(2);
    });

    it("复用调用方传入的 summary（优先于 pipeline 自动生成的)", async () => {
      memoryServiceStub.listMemories.mockReturnValue([]);

      await orchestrator.processIngest("src", "ingest", "content", "Title", "User Summary", []);

      const enqueuedEvent = memoryServiceStub.enqueueEvent.mock.calls[0][0];
      const candidate = JSON.parse(enqueuedEvent.candidate);
      expect(candidate.summary).toBe("User Summary");
    });

    it("合并调用方 tags 与 pipeline 自动提取的 tags", async () => {
      memoryServiceStub.listMemories.mockReturnValue([]);

      await orchestrator.processIngest("src", "ingest", "content", "Title", "Summary", [
        "user-tag",
      ]);

      const enqueuedEvent = memoryServiceStub.enqueueEvent.mock.calls[0][0];
      const candidate = JSON.parse(enqueuedEvent.candidate);
      expect(candidate.tags).toContain("user-tag");
      expect(candidate.tags).toContain("pipe-tag");
    });

    it("多 chunk 合并为 markdown 分段正文", async () => {
      memoryServiceStub.listMemories.mockReturnValue([]);
      pipelineMock.pipelineResult = {
        isDuplicate: false,
        similarity: 0,
        chunks: [
          { content: "part A", summary: "sum A", tags: [] },
          { content: "part B", summary: "sum B", tags: [] },
        ],
      };

      await orchestrator.processIngest("src", "ingest", "content", "Title", "Summary", []);

      const enqueuedEvent = memoryServiceStub.enqueueEvent.mock.calls[0][0];
      const candidate = JSON.parse(enqueuedEvent.candidate);
      expect(candidate.content).toContain("## 部分 1");
      expect(candidate.content).toContain("## 部分 2");
    });

    it("单 chunk 直接使用原始内容，不加 markdown 标题", async () => {
      memoryServiceStub.listMemories.mockReturnValue([]);

      await orchestrator.processIngest("src", "ingest", "content", "Title", "Summary", []);

      const enqueuedEvent = memoryServiceStub.enqueueEvent.mock.calls[0][0];
      const candidate = JSON.parse(enqueuedEvent.candidate);
      expect(candidate.content).toBe("cleaned content");
    });

    it("pipeline 返回 isDuplicate 时抛出 MemoryValidationError", async () => {
      memoryServiceStub.listMemories.mockReturnValue([]);
      pipelineMock.pipelineResult = {
        isDuplicate: true,
        similarity: 0.85,
        chunks: [],
      };

      await expect(
        orchestrator.processIngest("src", "ingest", "dup content", "T", "S"),
      ).rejects.toThrow(MemoryValidationError);
    });

    it("pipeline 返回空 chunks 时抛出 MemoryValidationError", async () => {
      memoryServiceStub.listMemories.mockReturnValue([]);
      pipelineMock.pipelineResult = {
        isDuplicate: false,
        similarity: 0,
        chunks: [],
      };

      await expect(orchestrator.processIngest("src", "ingest", "", "T", "S")).rejects.toThrow(
        MemoryValidationError,
      );
    });

    it("validateMemoryRecord 返回 false 时抛出 MemoryValidationError", async () => {
      memoryServiceStub.listMemories.mockReturnValue([]);
      builderMock.validatorResult = false;

      await expect(
        orchestrator.processIngest("src", "ingest", "content", "T", "S"),
      ).rejects.toThrow(MemoryValidationError);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // processEvent — create path
  // ═══════════════════════════════════════════════════════════════

  describe("processEvent — 新建记忆", () => {
    it("新记忆不存在 → 使用队列中的稳定 ID 持久化 → 写 Markdown → 分类 → 索引", async () => {
      const event = { ...builderMock.pendingEvent, eventType: "ingest" };
      memoryServiceStub.getPendingEvents.mockReturnValue([event]);
      memoryServiceStub.getMemory.mockReturnValue(null); // 不存在
      memoryServiceStub.createMemoryRecord.mockResolvedValue("test-id");
      memoryServiceStub.listMemories.mockReturnValue([]);

      await orchestrator.processQueue();

      expect(event.status).toBe("done");
      expect(memoryServiceStub.createMemoryRecord).toHaveBeenCalledWith(
        expect.objectContaining({ id: event.memoryId, kind: "fact" }),
      );
      expect(memoryServiceStub.classifyMemory).toHaveBeenCalledWith(
        event.memoryId,
        expect.any(String),
      );
    });

    it("新建路径向量召回不可用（embedding 失败）→ fail-closed 转人工 review", async () => {
      const event = { ...builderMock.pendingEvent, eventType: "ingest", retryCount: 0 };
      memoryServiceStub.getPendingEvents.mockReturnValue([event]);
      memoryServiceStub.getMemory.mockReturnValue(null);

      const modelAdapter = await import("../lib/ai/model-adapter");
      vi.mocked(modelAdapter.ModelAdapter.generateEmbedding).mockRejectedValueOnce(
        new Error("embedding down"),
      );

      await orchestrator.processQueue();

      expect(event.status).toBe("review");
      expect(event.retryCount).toBe(0);
      expect(memoryServiceStub.createMemoryRecord).not.toHaveBeenCalled();
      const fileManager = await import("../lib/storage/file-manager");
      expect(fileManager.createFailureRecord).toHaveBeenCalledWith(
        "test-id",
        "vector-recall",
        expect.any(Error),
      );
    });

    it("派生存储同步失败（写 Markdown 抛错）→ 记忆已入库、事件仍 done、归档失败记录", async () => {
      const event = { ...builderMock.pendingEvent, eventType: "ingest", retryCount: 0 };
      memoryServiceStub.getPendingEvents.mockReturnValue([event]);
      // 第一次 getMemory（存在性检查）→ 不存在；commitNewMemory 内取回刚入库的记录
      memoryServiceStub.getMemory
        .mockReturnValueOnce(null)
        .mockReturnValue({ ...builderMock.memoryRecord });
      memoryServiceStub.createMemoryRecord.mockResolvedValue("test-id");
      memoryServiceStub.listMemories.mockReturnValue([]);

      const memoryWriter = await import("../lib/storage/memory-writer");
      vi.mocked(memoryWriter.writeMemoryMarkdown).mockRejectedValueOnce(new Error("disk full"));

      await orchestrator.processQueue();

      expect(event.status).toBe("done");
      expect(event.retryCount).toBe(0);
      expect(memoryServiceStub.createMemoryRecord).toHaveBeenCalledWith(
        expect.objectContaining({ id: event.memoryId }),
      );
      const fileManager = await import("../lib/storage/file-manager");
      expect(fileManager.createFailureRecord).toHaveBeenCalledWith(
        "test-id",
        "write-memory-markdown",
        expect.any(Error),
      );
    });

    it("分类失败（classifyMemory 抛错）→ 记忆已入库、事件仍 done", async () => {
      const event = { ...builderMock.pendingEvent, eventType: "ingest", retryCount: 0 };
      memoryServiceStub.getPendingEvents.mockReturnValue([event]);
      memoryServiceStub.getMemory
        .mockReturnValueOnce(null)
        .mockReturnValue({ ...builderMock.memoryRecord });
      memoryServiceStub.createMemoryRecord.mockResolvedValue("test-id");
      memoryServiceStub.listMemories.mockReturnValue([]);
      memoryServiceStub.classifyMemory.mockImplementation(() => {
        throw new Error("classify boom");
      });

      await orchestrator.processQueue();

      expect(event.status).toBe("done");
      expect(event.retryCount).toBe(0);
      expect(memoryServiceStub.createMemoryRecord).toHaveBeenCalled();
    });

    it("质量闸门 reject → status=rejected → 不重试 → 记录失败", async () => {
      const event = { ...builderMock.pendingEvent, eventType: "ingest", retryCount: 0 };
      memoryServiceStub.getPendingEvents.mockReturnValue([event]);
      memoryServiceStub.getMemory.mockReturnValue(null);
      qualityFilterMock.mockResolvedValue({
        verdict: "reject",
        score: 2,
        reason: "低质量内容",
      });

      await orchestrator.processQueue();

      expect(event.status).toBe("rejected");
      expect(event.retryCount).toBe(0);
    });

    it("质量闸门 review → status=review → 不重试不落盘", async () => {
      const event = { ...builderMock.pendingEvent, eventType: "ingest", retryCount: 0 };
      memoryServiceStub.getPendingEvents.mockReturnValue([event]);
      memoryServiceStub.getMemory.mockReturnValue(null);
      qualityFilterMock.mockResolvedValue({
        verdict: "review",
        score: 5,
        reason: "处于灰区",
      });

      await orchestrator.processQueue();

      expect(event.status).toBe("review");
      expect(event.retryCount).toBe(0);
      expect(memoryServiceStub.createMemoryRecord).not.toHaveBeenCalled();
    });

    it("向量去重：召回相似度 ≥ 0.95 → status=rejected → 不调用质量闸门", async () => {
      const event = { ...builderMock.pendingEvent, eventType: "ingest", retryCount: 0 };
      memoryServiceStub.getPendingEvents.mockReturnValue([event]);
      memoryServiceStub.getMemory.mockImplementation((id: string) =>
        id === "existing-mem"
          ? { ...builderMock.memoryRecord, id: "existing-mem", title: "已有记忆" }
          : null,
      );
      vectorIndexSearch.mockReturnValue([{ memoryId: "existing-mem", similarity: 0.97 }]);

      await orchestrator.processQueue();

      expect(event.status).toBe("rejected");
      expect(qualityFilterMock).not.toHaveBeenCalled();
    });

    it("闸门收到相似记忆提示（新颖性上下文注入）", async () => {
      const event = { ...builderMock.pendingEvent, eventType: "ingest" };
      memoryServiceStub.getPendingEvents.mockReturnValue([event]);
      memoryServiceStub.getMemory.mockImplementation((id: string) =>
        id === "hint-mem"
          ? { ...builderMock.memoryRecord, id: "hint-mem", title: "相似记忆", summary: "相似摘要" }
          : null,
      );
      vectorIndexSearch.mockReturnValue([{ memoryId: "hint-mem", similarity: 0.75 }]);
      memoryServiceStub.createMemoryRecord.mockResolvedValue("test-id");
      memoryServiceStub.listMemories.mockReturnValue([]);

      await orchestrator.processQueue();

      expect(qualityFilterMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.arrayContaining([expect.objectContaining({ title: "相似记忆", similarity: 0.75 })]),
      );
      expect(event.status).toBe("done");
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // processEvent — delete path
  // ═══════════════════════════════════════════════════════════════

  describe("processEvent — 删除记忆", () => {
    it("delete 事件 → 直接删除 → status=done", async () => {
      const event = {
        ...builderMock.pendingEvent,
        eventType: "delete",
        status: "pending" as const,
      };
      memoryServiceStub.getPendingEvents.mockReturnValue([event]);
      memoryServiceStub.getMemory.mockReturnValue(builderMock.memoryRecord);

      await orchestrator.processQueue();

      expect(memoryServiceStub.deleteMemory).toHaveBeenCalledWith(
        builderMock.pendingEvent.memoryId,
      );
      expect(event.status).toBe("done");
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // processEvent — update path
  // ═══════════════════════════════════════════════════════════════

  describe("processEvent — 更新记忆", () => {
    it("Auditor 返回 auto_merge → updateMemory → 同步 Markdown + 分类 + 索引", async () => {
      const event = {
        ...builderMock.pendingEvent,
        eventType: "ingest",
        changedFields: ["content", "title"],
      };
      memoryServiceStub.getPendingEvents.mockReturnValue([event]);
      memoryServiceStub.getMemory.mockReturnValue(builderMock.memoryRecord);
      memoryServiceStub.listMemories.mockReturnValue([]);

      auditorProcessMock.mockResolvedValue({
        status: "done",
        resolution: {
          action: "auto_merge",
          merged: {
            title: "merged title",
            content: "merged content",
            tags: ["merged"],
            summary: "merged summary",
            graphLinks: [],
          },
          conflicts: [],
        },
      });

      await orchestrator.processQueue();

      expect(memoryServiceStub.updateMemory).toHaveBeenCalledWith(
        builderMock.pendingEvent.memoryId,
        expect.objectContaining({ title: "merged title", content: "merged content" }),
      );
      expect(event.status).toBe("done");
    });

    it("Auditor 返回 manual_decision → AuditService.createConflict → status=done", async () => {
      const event = {
        ...builderMock.pendingEvent,
        eventType: "ingest",
        changedFields: ["title"],
      };
      memoryServiceStub.getPendingEvents.mockReturnValue([event]);
      memoryServiceStub.getMemory.mockReturnValue(builderMock.memoryRecord);

      auditorProcessMock.mockResolvedValue({
        status: "conflict",
        resolution: {
          action: "manual_decision",
          conflicts: [
            {
              field: "title",
              existingValue: "old title",
              candidateValue: "new title",
            },
          ],
          merged: null,
        },
      });

      await orchestrator.processQueue();

      expect(event.status).toBe("done");
      // createConflict 被 AuditService 调用
      const auditService = (orchestrator as any).auditService;
      expect(auditService.createConflict).toHaveBeenCalledWith(
        builderMock.pendingEvent.memoryId,
        "evt-1",
        "title",
        "old title",
        "new title",
      );
    });

    it("更新内容质量 review 时禁 auto_merge → 不写回，逐字段生成冲突转人工", async () => {
      const event = {
        ...builderMock.pendingEvent,
        eventType: "ingest",
        changedFields: ["content", "title"],
      };
      memoryServiceStub.getPendingEvents.mockReturnValue([event]);
      const existing = { ...builderMock.memoryRecord, content: "旧正文", title: "旧标题" };
      memoryServiceStub.getMemory.mockReturnValue(existing);
      memoryServiceStub.listMemories.mockReturnValue([]);
      qualityFilterMock.mockResolvedValue({
        verdict: "review",
        score: 5,
        kind: "fact",
        reason: "更新质量存疑",
      });

      auditorProcessMock.mockResolvedValue({
        status: "done",
        resolution: {
          action: "auto_merge",
          merged: { content: "借更新洗入的内容", title: "洗入标题" },
          conflicts: [],
        },
      });

      await orchestrator.processQueue();

      // 禁止 auto_merge 写回
      expect(memoryServiceStub.updateMemory).not.toHaveBeenCalled();
      // candidate 与 existing 的差异字段逐条转人工冲突
      const auditService = (orchestrator as any).auditService;
      expect(auditService.createConflict).toHaveBeenCalledTimes(2);
      expect(auditService.createConflict).toHaveBeenCalledWith(
        event.memoryId,
        "evt-1",
        "content",
        "旧正文",
        "test content",
      );
      expect(auditService.createConflict).toHaveBeenCalledWith(
        event.memoryId,
        "evt-1",
        "title",
        "旧标题",
        "test title",
      );
      // 审计阶段已结束，待裁决状态由 conflict_records 承载
      expect(event.status).toBe("done");
    });

    it("更新路径向量召回不可用 → 跳过语义去重继续审计，auto_merge 正常写回", async () => {
      const event = {
        ...builderMock.pendingEvent,
        eventType: "ingest",
        changedFields: ["content"],
      };
      memoryServiceStub.getPendingEvents.mockReturnValue([event]);
      memoryServiceStub.getMemory.mockReturnValue(builderMock.memoryRecord);
      memoryServiceStub.listMemories.mockReturnValue([]);

      const modelAdapter = await import("../lib/ai/model-adapter");
      vi.mocked(modelAdapter.ModelAdapter.generateEmbedding).mockRejectedValueOnce(
        new Error("embedding down"),
      );

      auditorProcessMock.mockResolvedValue({
        status: "done",
        resolution: { action: "auto_merge", merged: { content: "merged content" }, conflicts: [] },
      });

      await orchestrator.processQueue();

      expect(memoryServiceStub.updateMemory).toHaveBeenCalledWith(
        builderMock.pendingEvent.memoryId,
        expect.objectContaining({ content: "merged content" }),
      );
      expect(event.status).toBe("done");
    });

    it("Auditor 返回 null（dequeue 失败）→ status=failed", async () => {
      const event = {
        ...builderMock.pendingEvent,
        eventType: "ingest",
        retryCount: 0,
      };
      memoryServiceStub.getPendingEvents.mockReturnValue([event]);
      memoryServiceStub.getMemory.mockReturnValue(builderMock.memoryRecord);
      auditorProcessMock.mockResolvedValue(null);

      await orchestrator.processQueue();

      expect(event.status).toBe("failed");
      expect(event.retryCount).toBe(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // processQueue — 整体调度
  // ═══════════════════════════════════════════════════════════════

  describe("processQueue", () => {
    it("无待处理事件 → 不更新索引", async () => {
      memoryServiceStub.getPendingEvents.mockReturnValue([]);

      await orchestrator.processQueue();

      const indexWriter = await import("../lib/storage/index-writer");
      expect(indexWriter.updateIndexMap).not.toHaveBeenCalled();
    });

    it("有待处理事件 → 处理后更新索引 map + 生成审计报告", async () => {
      const event = {
        ...builderMock.pendingEvent,
        eventType: "ingest",
      };
      memoryServiceStub.getPendingEvents.mockReturnValue([event]);
      memoryServiceStub.getMemory.mockReturnValue(null); // 新建
      memoryServiceStub.createMemoryRecord.mockResolvedValue("test-id");
      memoryServiceStub.listMemories.mockReturnValue([]);

      await orchestrator.processQueue();

      const indexWriter = await import("../lib/storage/index-writer");
      expect(indexWriter.updateIndexMap).toHaveBeenCalled();
    });

    it("按批次读取待处理事件，避免一次性加载全部队列", async () => {
      memoryServiceStub.getPendingEvents.mockReturnValue([]);

      await orchestrator.processQueue();

      expect(memoryServiceStub.getPendingEvents).toHaveBeenCalledWith({
        limit: expect.any(Number),
      });
    });

    it("异常事件 → catch 后置 failed + retryCount++ + 写失败记录", async () => {
      const event = {
        ...builderMock.pendingEvent,
        eventType: "ingest",
        retryCount: 0,
      };
      memoryServiceStub.getPendingEvents.mockReturnValue([event]);
      memoryServiceStub.getMemory.mockReturnValue(null);
      // 强制稳定 ID 持久化入口抛异常
      memoryServiceStub.createMemoryRecord.mockRejectedValue(new Error("DB error"));

      await orchestrator.processQueue();

      expect(event.status).toBe("failed");
      expect(event.retryCount).toBe(1);
    });

    it("candidate JSON 损坏时写入带上下文的失败记录", async () => {
      const event = {
        ...builderMock.pendingEvent,
        eventId: "evt-bad-json",
        memoryId: "memory-bad-json",
        candidate: "{",
        retryCount: 0,
      };
      memoryServiceStub.getPendingEvents.mockReturnValue([event]);

      await orchestrator.processQueue();

      const fileManager = await import("../lib/storage/file-manager");
      expect(fileManager.createFailureRecord).toHaveBeenCalledWith(
        "memory-bad-json",
        "orchestrator-process",
        expect.objectContaining({
          message: expect.stringContaining("evt-bad-json"),
        }),
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // resolveReviewEvent — 人工裁决
  // ═══════════════════════════════════════════════════════════════

  describe("resolveReviewEvent", () => {
    const makeReviewEvent = () => ({
      ...builderMock.pendingEvent,
      status: "review" as const,
      retryCount: 0,
    });

    it("accept → 跳过闸门直接落盘 → status=done", async () => {
      const event = makeReviewEvent();
      memoryServiceStub.getEvent.mockReturnValue(event);
      memoryServiceStub.createMemoryRecord.mockResolvedValue("test-id");
      memoryServiceStub.listMemories.mockReturnValue([]);

      const result = await orchestrator.resolveReviewEvent("evt-1", "accept");

      expect(qualityFilterMock).not.toHaveBeenCalled();
      expect(memoryServiceStub.createMemoryRecord).toHaveBeenCalled();
      expect(result.status).toBe("done");
    });

    it("reject → status=rejected → 归档失败记录", async () => {
      const event = makeReviewEvent();
      memoryServiceStub.getEvent.mockReturnValue(event);

      const result = await orchestrator.resolveReviewEvent("evt-1", "reject");

      expect(result.status).toBe("rejected");
      expect(memoryServiceStub.createMemoryRecord).not.toHaveBeenCalled();
      const fileManager = await import("../lib/storage/file-manager");
      expect(fileManager.createFailureRecord).toHaveBeenCalledWith(
        event.memoryId,
        "review-decision",
        expect.any(Error),
      );
    });

    it("事件不在 review 状态 → 抛错", async () => {
      memoryServiceStub.getEvent.mockReturnValue({
        ...builderMock.pendingEvent,
        status: "pending" as const,
      });

      await expect(orchestrator.resolveReviewEvent("evt-1", "accept")).rejects.toThrow(
        "事件不在待审状态",
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // close
  // ═══════════════════════════════════════════════════════════════

  describe("close", () => {
    it("关闭所有子服务", () => {
      orchestrator.close();

      expect(memoryServiceStub.close).toHaveBeenCalled();
      expect(auditorCloseMock).toHaveBeenCalled();
    });
  });
});
