import { beforeEach, describe, expect, it, vi } from "vitest";

// env 固化：MEMORY_ROOT 透传 process.env——setup.ts 已先于测试模块设置临时目录
vi.mock("../config/env", () => ({
  env: {
    NODE_ENV: "test",
    MODEL_API_KEY: "",
    MODEL_BASE_URL: "http://localhost:8080",
    MEMORY_ROOT: process.env.MEMORY_ROOT || "./memory-root",
    PORT: 3000,
    RERANK_MODEL: "Xenova/bge-reranker-base",
    RERANK_HF_ENDPOINT: "https://hf-mirror.com",
    RERANK_DISABLED: false,
  },
}));

// ── mock: 模型适配器与对话分析器（worker 默认依赖链隔离） ──
const adapterMocks = vi.hoisted(() => ({
  degraded: false,
  generate: vi.fn(),
}));
vi.mock("../lib/ai/model-adapter", () => ({
  ModelAdapter: {
    get isDegradedMode() {
      return adapterMocks.degraded;
    },
    generate: adapterMocks.generate,
  },
}));

const analyzerMocks = vi.hoisted(() => ({
  analyzeTurn: vi.fn(),
}));
vi.mock("../server/services/memory-extraction-service", () => ({
  MemoryExtractionService: vi.fn(() => ({
    analyzeTurn: analyzerMocks.analyzeTurn,
  })),
}));

const reconcileMocks = vi.hoisted(() => ({
  reconcile: vi.fn(),
}));
vi.mock("../server/services/knowledge-reconciliation-service", () => ({
  KnowledgeReconciliationService: vi.fn(() => ({
    reconcile: reconcileMocks.reconcile,
  })),
}));

const memoryMocks = vi.hoisted(() => ({
  stageCreateMemory: vi.fn(() => "new-mem-id"),
  stageUpdateMemory: vi.fn(() => "evt-1"),
  getMemory: vi.fn(() => null),
}));
vi.mock("../server/services/memory-service", () => ({
  MemoryService: vi.fn(() => memoryMocks),
}));

import { getDatabase } from "../lib/storage/database";
import { ConversationLearningWorker } from "../server/workers/conversation-learning-worker";
import { ConversationLearningService } from "../server/services/conversation-learning-service";

const taskInput = {
  turnId: "turn-w1",
  sessionId: "sess-w",
  mode: "chat" as const,
  userText: "帮我记一下部署命令",
  assistantText: "部署命令是 npm run deploy。",
};

describe("ConversationLearningWorker — 第十块注入真实处理器链", () => {
  beforeEach(() => {
    adapterMocks.degraded = false;
    adapterMocks.generate.mockReset();
    analyzerMocks.analyzeTurn.mockReset();
    reconcileMocks.reconcile.mockReset();
    memoryMocks.stageCreateMemory.mockClear();
    memoryMocks.stageUpdateMemory.mockClear();
    memoryMocks.getMemory.mockClear();
    // 触发建表后清空，保证每用例从空表开始
    new ConversationLearningService().close();
    getDatabase().prepare("DELETE FROM conversation_learning_tasks").run();
  });

  it("start 后默认装配 analyzeTurn 处理器：skip 任务被处理为 completed", async () => {
    const service = new ConversationLearningService();
    try {
      service.enqueueCompletedTurn(taskInput);
      analyzerMocks.analyzeTurn.mockResolvedValue({
        type: "skip",
        reason: "命令速记，无长期知识",
      });

      const worker = new ConversationLearningWorker({ pollIntervalMs: 20 });
      void worker.start();

      await vi.waitFor(
        () => {
          expect(service.getTask("turn-w1")!.status).toBe("completed");
        },
        { timeout: 2000 },
      );
      const task = service.getTask("turn-w1")!;
      expect(task.resultSummary).toContain("无新增知识");
      expect(task.resultSummary).toContain("命令速记");
      expect(analyzerMocks.analyzeTurn).toHaveBeenCalledWith(
        expect.objectContaining({
          turnId: "turn-w1",
          userText: taskInput.userText,
          assistantText: taskInput.assistantText,
        }),
      );

      worker.stop();
    } finally {
      service.close();
    }
  });

  it("处理器返回 unavailable → 任务 failed 且不重试", async () => {
    const service = new ConversationLearningService();
    try {
      service.enqueueCompletedTurn(taskInput);
      analyzerMocks.analyzeTurn.mockResolvedValue({
        type: "unavailable",
        reason: "模型降级，无法分析",
      });

      const worker = new ConversationLearningWorker({ pollIntervalMs: 20 });
      void worker.start();

      await vi.waitFor(
        () => {
          expect(service.getTask("turn-w1")!.status).toBe("failed");
        },
        { timeout: 2000 },
      );
      expect(service.getTask("turn-w1")!.resultSummary).toContain("模型降级");

      worker.stop();
    } finally {
      service.close();
    }
  });

  it("第十一块：knowledge auto 卡经协调落候选（new → stageCreateMemory，摘要含计数）", async () => {
    const service = new ConversationLearningService();
    try {
      service.enqueueCompletedTurn(taskInput);
      analyzerMocks.analyzeTurn.mockResolvedValue({
        type: "knowledge",
        items: [
          {
            title: "部署命令",
            summary: "项目用 npm run deploy 部署",
            content: "本项目部署命令是 npm run deploy。",
            tags: ["部署"],
            source: "user",
            kind: "fact",
            topic: "tech",
            evidence: { sourceRole: "user", text: "部署命令", verified: true },
            reviewStatus: "auto",
          },
        ],
      });
      reconcileMocks.reconcile.mockResolvedValue({
        type: "ok",
        decisions: [{ decision: "new", review: false, reason: "独立知识" }],
        acceptedCount: 1,
        pendingCount: 0,
        duplicateCount: 0,
      });

      const worker = new ConversationLearningWorker({ pollIntervalMs: 20 });
      void worker.start();

      await vi.waitFor(
        () => {
          expect(service.getTask("turn-w1")!.status).toBe("completed");
        },
        { timeout: 2000 },
      );
      const task = service.getTask("turn-w1")!;
      expect(task.resultSummary).toContain("1 张知识卡");
      // 协调摘要附加进 result_json（接受/待确认分开计数）
      const parsed = task.resultJson as {
        reconciliation?: { accepted: number; pending: number; duplicates: number };
      };
      expect(parsed.reconciliation).toEqual({ duplicates: 0, accepted: 1, pending: 0 });
      // new 决策经 stage 通路落 create 候选
      expect(memoryMocks.stageCreateMemory).toHaveBeenCalledTimes(1);
      expect(memoryMocks.stageCreateMemory).toHaveBeenCalledWith(
        "对话学习",
        "chat",
        "部署命令",
        expect.any(String),
        expect.any(String),
        expect.any(Array),
        "tech",
        undefined,
        undefined,
        expect.objectContaining({ kind: "fact" }),
      );

      worker.stop();
    } finally {
      service.close();
    }
  });

  it("第十一块：协调不可用 → 任务仍 completed，摘要记 pending 与原因", async () => {
    const service = new ConversationLearningService();
    try {
      service.enqueueCompletedTurn(taskInput);
      analyzerMocks.analyzeTurn.mockResolvedValue({
        type: "knowledge",
        items: [
          {
            title: "卡",
            summary: "s",
            content: "c",
            tags: [],
            source: "user",
            kind: "fact",
            topic: "tech",
            evidence: { sourceRole: "user", text: "部署命令", verified: true },
            reviewStatus: "auto",
          },
        ],
      });
      reconcileMocks.reconcile.mockResolvedValue({
        type: "unavailable",
        reason: "知识协调输出 2 次均无法通过契约校验",
      });

      const worker = new ConversationLearningWorker({ pollIntervalMs: 20 });
      void worker.start();

      await vi.waitFor(
        () => {
          expect(service.getTask("turn-w1")!.status).toBe("completed");
        },
        { timeout: 2000 },
      );
      const parsed = service.getTask("turn-w1")!.resultJson as {
        reconciliation?: { pending: number; unavailableReason?: string };
      };
      expect(parsed.reconciliation!.pending).toBe(1);
      expect(parsed.reconciliation!.unavailableReason).toContain("契约校验");
      expect(memoryMocks.stageCreateMemory).not.toHaveBeenCalled();

      worker.stop();
    } finally {
      service.close();
    }
  });

  it("stop 后不再取出新任务", async () => {
    const service = new ConversationLearningService();
    try {
      const worker = new ConversationLearningWorker({ pollIntervalMs: 20 });
      void worker.start();
      worker.stop();

      service.enqueueCompletedTurn(taskInput);
      analyzerMocks.analyzeTurn.mockResolvedValue({ type: "skip", reason: "不应被调用" });

      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(service.getTask("turn-w1")!.status).toBe("queued");
      expect(analyzerMocks.analyzeTurn).not.toHaveBeenCalled();
    } finally {
      service.close();
    }
  });
});
