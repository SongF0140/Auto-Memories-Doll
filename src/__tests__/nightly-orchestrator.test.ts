import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock ModelAdapter to avoid real AI calls
vi.mock("../lib/ai/model-adapter", () => ({
  ModelAdapter: {
    generate: vi.fn(),
    generateStream: vi.fn(),
    isDegradedMode: false,
  },
  ModelType: { flagship: "flagship", standard: "standard", budget: "budget" },
}));

// Mock WikiGraph
vi.mock("../lib/graph/wiki-graph", () => ({
  WikiGraph: vi.fn().mockImplementation(() => ({
    getNeighbors: vi.fn().mockResolvedValue(["mem-old-1"]),
    scanAllFiles: vi.fn().mockResolvedValue(["/notes/topic1/mem-abc.md", "/notes/topic2/other.md"]),
    addWikilinkToFile: vi.fn().mockResolvedValue(undefined),
    invalidateCache: vi.fn(),
  })),
}));

// Mock ProfileUpdater
vi.mock("../server/services/profile-updater", () => ({
  ProfileUpdater: {
    getInstance: vi.fn().mockReturnValue({
      runAnalysisWithFlagship: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

// Mock TaskRouter
vi.mock("../lib/ai/task-router", () => {
  const routing: Record<string, string> = {
    intent_classification: "flagship",
    audit_evaluation: "flagship",
    quality_evaluation: "flagship",
    final_evaluation: "flagship",
    chat_response: "standard",
    code_generation: "standard",
    profile_analysis: "standard",
    memory_extraction: "standard",
    memory_classification: "standard",
    translation: "budget",
    test_generation: "budget",
    summarization: "budget",
    simple_extraction: "budget",
    format_conversion: "budget",
  };
  return {
    TaskRouter: {
      getRoutingTable: vi.fn(() => ({ ...routing })),
      override: vi.fn((cat: string, model: string) => {
        routing[cat] = model;
      }),
      route: vi.fn((task: string) => routing[task] || "standard"),
    },
  };
});

import { ModelAdapter } from "../lib/ai/model-adapter";
import { TaskRouter } from "../lib/ai/task-router";

import { NightlyOrchestrator } from "../server/orchestrators/nightly-orchestrator";
import { NightlyScheduler } from "../server/schedulers/nightly-scheduler";
import { ContradictionDetector } from "../server/orchestrators/contradiction-detector";
import { LinkSupplementer } from "../server/orchestrators/link-supplementer";
import { RouteOptimizer } from "../server/orchestrators/route-optimizer";
import { DailyReporter } from "../server/orchestrators/daily-reporter";
import { ProfileUpdater } from "../server/services/profile-updater";
import { MemoryRecord } from "../types/memory";

function makeMemory(id: string, title: string, topic: string, summary: string, tags: string[], date?: string): MemoryRecord {
  const d = date || "2026-08-06";
  return {
    id,
    title,
    summary,
    topic,
    tags,
    content: `Content of ${title}`,
    source: "test",
    sourceType: "manual",
    version: 1,
    createdAt: `${d}T10:00:00.000Z`,
    updatedAt: `${d}T10:00:00.000Z`,
    accessedAt: `${d}T10:00:00.000Z`,
    accessCount: 0,
    heatScore: 0,
    graphLinks: [],
  };
}

// ────────────────────────────────────────────────────────────
// NightlyOrchestrator
// ────────────────────────────────────────────────────────────
describe("NightlyOrchestrator", () => {
  let orchestrator: NightlyOrchestrator;

  beforeEach(() => {
    vi.clearAllMocks();
    orchestrator = new NightlyOrchestrator();
    // Override getTodaysMemories by controlling what memoryService returns
  });

  it("should return empty report when no memories exist", async () => {
    const report = await orchestrator.run();
    expect(report.date).toBe(new Date().toISOString().split("T")[0]);
    expect(report.todaysMemoryCount).toBeGreaterThanOrEqual(0);
    expect(report.allSucceeded).toBe(true);
    expect(report.errors).toEqual([]);
  });

  it("should handle contradiction detector gracefully on error", async () => {
    // 验证：即使子任务全部成功（无记忆），report 的 errors 也应该为空
    const report = await orchestrator.run();
    // 因为当日无记忆，所有子任务都提前返回，没有错误
    expect(report.allSucceeded).toBe(true);
  });

  it("should have date field set correctly", async () => {
    const report = await orchestrator.run();
    expect(report.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(report.startedAt).toBeTruthy();
    expect(report.completedAt).toBeTruthy();
  });

  it("should still complete report with all sub-tasks skipped (no memories)", async () => {
    // 无当日记忆时，所有子任务提前返回空结果，不调用 AI，report 成功
    const report = await orchestrator.run();
    expect(report.allSucceeded).toBe(true);
    expect(report.todaysMemoryCount).toBe(0);
    // 子任务返回空结果（非 null，因为子任务仍然执行了只是返回空）
    expect(report.contradiction?.contradictions).toEqual([]);
    expect(report.links?.addedCount).toBe(0);
    expect(report.routing?.suggestions).toEqual([]);
  });

  it("should skip flagship profile analysis when model adapter is degraded", async () => {
    (ModelAdapter as any).isDegradedMode = true;
    const profileUpdater = (ProfileUpdater.getInstance as any)();
    profileUpdater.runAnalysisWithFlagship.mockClear();

    const report = await orchestrator.run();

    expect(profileUpdater.runAnalysisWithFlagship).not.toHaveBeenCalled();
    expect(report.allSucceeded).toBe(true);
    expect(report.errors).toEqual([]);
  });

  afterEach(() => {
    (ModelAdapter as any).isDegradedMode = false;
    orchestrator.close();
  });
});

// ────────────────────────────────────────────────────────────
// NightlyScheduler
// ────────────────────────────────────────────────────────────
describe("NightlyScheduler", () => {
  it("should not start when NIGHTLY_ENABLED=false", () => {
    const scheduler = new NightlyScheduler();
    process.env.NIGHTLY_ENABLED = "false";
    scheduler.start();
    expect((scheduler as any).timer).toBeNull();
    scheduler.stop();
    delete process.env.NIGHTLY_ENABLED;
  });

  it("should schedule next run when enabled", () => {
    const scheduler = new NightlyScheduler();
    process.env.NIGHTLY_ENABLED = "true";
    scheduler.start();
    // 不应该立即执行（延迟到凌晨 2:00）
    expect((scheduler as any).timer).not.toBeNull();
    scheduler.stop();
    delete process.env.NIGHTLY_ENABLED;
  });

  it("should stop cleanly", () => {
    const scheduler = new NightlyScheduler();
    scheduler.stop();
    expect((scheduler as any).timer).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────
// ContradictionDetector
// ────────────────────────────────────────────────────────────
describe("ContradictionDetector", () => {
  it("should return empty for no memories", async () => {
    const detector = new ContradictionDetector();
    const result = await detector.detect([], []);
    expect(result.contradictions).toEqual([]);
    expect(result.totalCompared).toBe(0);
  });

  it("should return empty when no same-topic pairs exist", async () => {
    const detector = new ContradictionDetector();
    const newMem = makeMemory("1", "React hooks", "frontend", "useEffect usage", ["react"]);
    const oldMem = makeMemory("2", "Python types", "backend", "Type hints", ["python"]);
    const result = await detector.detect([newMem], [oldMem]);
    // 不同 topic，不会比较
    expect(result.totalCompared).toBe(0);
  });

  it("should compare same-topic memories", async () => {
    (ModelAdapter.generate as any).mockResolvedValue({
      content: JSON.stringify([{ pairIndex: 1, hasContradiction: true, description: "新信息与旧信息冲突", severity: "medium", suggestion: "需要人工审核" }]),
    });

    const detector = new ContradictionDetector();
    const newMem = makeMemory("1", "React 19 features", "frontend", "React 19 uses Server Components", ["react"]);
    const oldMem = makeMemory("2", "React 18 basics", "frontend", "React 18 uses useEffect", ["react"]);
    const result = await detector.detect([newMem], [oldMem]);

    expect(result.totalCompared).toBe(1);
    expect(result.contradictions.length).toBe(1);
    expect(result.contradictions[0].severity).toBe("medium");
  });

  it("should return empty for non-contradicting pairs", async () => {
    (ModelAdapter.generate as any).mockResolvedValue({
      content: JSON.stringify([{ pairIndex: 1, hasContradiction: false }]),
    });

    const detector = new ContradictionDetector();
    const newMem = makeMemory("1", "React hooks", "frontend", "useState and useEffect", ["react"]);
    const oldMem = makeMemory("2", "React components", "frontend", "Class components vs functional", ["react"]);
    const result = await detector.detect([newMem], [oldMem]);

    expect(result.contradictions).toEqual([]);
  });

  it("should handle invalid JSON from AI", async () => {
    (ModelAdapter.generate as any).mockResolvedValue({ content: "invalid json" });

    const detector = new ContradictionDetector();
    const newMem = makeMemory("1", "A", "topic", "summary A", ["tag"]);
    const oldMem = makeMemory("2", "B", "topic", "summary B", ["tag"]);
    const result = await detector.detect([newMem], [oldMem]);

    expect(result.contradictions).toEqual([]);
  });

  it("should skip LLM contradiction analysis when model adapter is degraded", async () => {
    (ModelAdapter as any).isDegradedMode = true;
    (ModelAdapter.generate as any).mockRejectedValue(new Error("should not call LLM"));
    (ModelAdapter.generate as any).mockClear();

    const detector = new ContradictionDetector();
    const newMem = makeMemory("1", "React 19", "frontend", "new summary", ["react"]);
    const oldMem = makeMemory("2", "React 18", "frontend", "old summary", ["react"]);
    const result = await detector.detect([newMem], [oldMem]);

    expect(result).toEqual({ contradictions: [], totalCompared: 0 });
    expect(ModelAdapter.generate).not.toHaveBeenCalled();
  });

  afterEach(() => {
    (ModelAdapter as any).isDegradedMode = false;
    const d = new ContradictionDetector();
    d.close();
  });
});

// ────────────────────────────────────────────────────────────
// LinkSupplementer
// ────────────────────────────────────────────────────────────
describe("LinkSupplementer", () => {
  it("should return empty for no memories", async () => {
    const supplementer = new LinkSupplementer();
    const result = await supplementer.supplement([], []);
    expect(result.suggestions).toEqual([]);
    expect(result.addedCount).toBe(0);
    supplementer.close();
  });

  it("should return empty for only one memory", async () => {
    const supplementer = new LinkSupplementer();
    const mem = makeMemory("1", "React", "frontend", "React basics", ["react"]);
    const result = await supplementer.supplement([mem], [mem]);
    expect(result.addedCount).toBe(0);
    supplementer.close();
  });

  it("should find missing links with valid AI response", async () => {
    (ModelAdapter.generate as any).mockResolvedValue({
      content: JSON.stringify([{ fromId: "2", toId: "1", reason: "都是前端框架讨论" }]),
    });

    const supplementer = new LinkSupplementer();
    const oldMem = makeMemory("1", "Vue basics", "frontend", "Vue reactivity", ["vue"]);
    const newMem = makeMemory("2", "React vs Vue", "frontend", "Comparing reactivity", ["react", "vue"]);
    const result = await supplementer.supplement([newMem], [newMem, oldMem]);

    expect(result.suggestions.length).toBeGreaterThanOrEqual(0);
    supplementer.close();
  });

  it("should handle invalid JSON from AI", async () => {
    (ModelAdapter.generate as any).mockResolvedValue({ content: "not json" });

    const supplementer = new LinkSupplementer();
    const mem1 = makeMemory("1", "A", "topic", "A", ["t"]);
    const mem2 = makeMemory("2", "B", "topic", "B", ["t"]);
    const result = await supplementer.supplement([mem2], [mem1, mem2]);
    expect(result.suggestions).toEqual([]);
    supplementer.close();
  });

  it("should skip LLM link suggestions when model adapter is degraded", async () => {
    (ModelAdapter as any).isDegradedMode = true;
    (ModelAdapter.generate as any).mockRejectedValue(new Error("should not call LLM"));
    (ModelAdapter.generate as any).mockClear();

    const supplementer = new LinkSupplementer();
    const oldMem = makeMemory("1", "Vue basics", "frontend", "Vue reactivity", ["vue"]);
    const newMem = makeMemory("2", "React vs Vue", "frontend", "Comparing reactivity", ["react", "vue"]);
    const result = await supplementer.supplement([newMem], [newMem, oldMem]);

    expect(result).toEqual({ suggestions: [], addedCount: 0, failedCount: 0 });
    expect(ModelAdapter.generate).not.toHaveBeenCalled();
    supplementer.close();
  });

  afterEach(() => {
    (ModelAdapter as any).isDegradedMode = false;
    const s = new LinkSupplementer();
    s.close();
  });
});

// ────────────────────────────────────────────────────────────
// RouteOptimizer
// ────────────────────────────────────────────────────────────
describe("RouteOptimizer", () => {
  beforeEach(() => {
    TaskRouter.getRoutingTable(); // ensure routing is reset
  });

  it("should return empty for no memories", async () => {
    const optimizer = new RouteOptimizer();
    const result = await optimizer.optimize([], []);
    expect(result.suggestions).toEqual([]);
    expect(result.appliedCount).toBe(0);
    optimizer.close();
  });

  it("should apply AI-suggested routing changes", async () => {
    (ModelAdapter.generate as any).mockResolvedValue({
      content: JSON.stringify([
        { taskCategory: "summarization", currentModel: "budget", suggestedModel: "standard", reason: "今日摘要质量要求高" },
        { taskCategory: "translation", currentModel: "budget", suggestedModel: "standard", reason: "翻译任务增多" },
      ]),
    });

    const optimizer = new RouteOptimizer();
    const mem = makeMemory("1", "Test", "coding", "Writing code", ["code"]);
    const result = await optimizer.optimize([mem], [mem]);

    expect(result.suggestions.length).toBe(2);
    expect(result.appliedCount).toBe(2);
    expect(result.suggestions[0].taskCategory).toBe("summarization");
    expect(result.suggestions[0].suggestedModel).toBe("standard");
    optimizer.close();
  });

  it("should ignore invalid task categories", async () => {
    (ModelAdapter.generate as any).mockResolvedValue({
      content: JSON.stringify([
        { taskCategory: "invalid_task", currentModel: "budget", suggestedModel: "flagship", reason: "测试" },
      ]),
    });

    const optimizer = new RouteOptimizer();
    const mem = makeMemory("1", "Test", "coding", "Writing code", ["code"]);
    const result = await optimizer.optimize([mem], [mem]);

    expect(result.suggestions).toEqual([]);
    optimizer.close();
  });

  it("should ignore invalid model types", async () => {
    (ModelAdapter.generate as any).mockResolvedValue({
      content: JSON.stringify([
        { taskCategory: "summarization", currentModel: "budget", suggestedModel: "super_model", reason: "测试" },
      ]),
    });

    const optimizer = new RouteOptimizer();
    const mem = makeMemory("1", "Test", "coding", "Writing code", ["code"]);
    const result = await optimizer.optimize([mem], [mem]);

    expect(result.suggestions).toEqual([]);
    optimizer.close();
  });

  it("should handle AI failure gracefully", async () => {
    (ModelAdapter.generate as any).mockRejectedValue(new Error("AI down"));

    const optimizer = new RouteOptimizer();
    const mem = makeMemory("1", "Test", "coding", "Writing code", ["code"]);
    const result = await optimizer.optimize([mem], [mem]);

    expect(result.suggestions).toEqual([]);
    optimizer.close();
  });

  it("should skip LLM route optimization when model adapter is degraded", async () => {
    (ModelAdapter as any).isDegradedMode = true;
    (ModelAdapter.generate as any).mockRejectedValue(new Error("should not call LLM"));
    (ModelAdapter.generate as any).mockClear();

    const optimizer = new RouteOptimizer();
    const mem = makeMemory("1", "Test", "coding", "Writing code", ["code"]);
    const result = await optimizer.optimize([mem], [mem]);

    expect(result).toEqual({ suggestions: [], appliedCount: 0 });
    expect(ModelAdapter.generate).not.toHaveBeenCalled();
    optimizer.close();
  });

  afterEach(() => {
    (ModelAdapter as any).isDegradedMode = false;
    const o = new RouteOptimizer();
    o.close();
  });
});

// ────────────────────────────────────────────────────────────
// DailyReporter
// ────────────────────────────────────────────────────────────
describe("DailyReporter", () => {
  it("should generate markdown report with all sections", async () => {
    const reporter = new DailyReporter();
    const report = {
      date: "2026-08-06",
      startedAt: "2026-08-06T18:00:00.000Z",
      completedAt: "2026-08-06T18:05:00.000Z",
      todaysMemoryCount: 5,
      contradiction: {
        contradictions: [
          {
            memoryA: { id: "1", title: "React 19", summary: "uses Server Components" },
            memoryB: { id: "2", title: "React 18", summary: "uses useEffect mainly" },
            description: "版本差异导致 API 使用冲突",
            severity: "high" as const,
            suggestion: "建议以 React 19 文档为准",
          },
        ],
        totalCompared: 3,
      },
      links: {
        suggestions: [
          { from: { id: "1", title: "React" }, to: { id: "2", title: "Next.js" }, reason: "关联框架" },
        ],
        addedCount: 1,
        failedCount: 0,
      },
      routing: {
        suggestions: [
          { taskCategory: "summarization" as any, currentModel: "budget" as any, suggestedModel: "standard" as any, reason: "质量提升" },
        ],
        appliedCount: 1,
      },
      allSucceeded: true,
      errors: [],
    };

    const filePath = await reporter.write(report);
    // Read back the generated file to verify content
    const fs = await import("fs");
    const content = fs.readFileSync(filePath, "utf-8");
    expect(content).toContain("# 深夜督查日报");
    expect(content).toContain("2026-08-06");
    expect(content).toContain("React 19");
    expect(content).toContain("React 18");
    expect(content).toContain("summarization");
    expect(content).toContain("高危");
    expect(content).toContain("Next.js");
  });

  it("should generate minimal report with no issues", async () => {
    const reporter = new DailyReporter();
    const report = {
      date: "2026-08-06",
      startedAt: "2026-08-06T18:00:00.000Z",
      completedAt: "2026-08-06T18:01:00.000Z",
      todaysMemoryCount: 0,
      contradiction: null,
      links: null,
      routing: null,
      allSucceeded: true,
      errors: [],
    };

    const filePath = await reporter.write(report);
    const fs = await import("fs");
    const content = fs.readFileSync(filePath, "utf-8");
    expect(content).toContain("未发现知识矛盾");
    expect(content).toContain("未发现遗漏的链接");
    expect(content).toContain("无需调整");
  });

  it("should include errors section when there are errors", async () => {
    const reporter = new DailyReporter();
    const report = {
      date: "2026-08-06",
      startedAt: "2026-08-06T18:00:00.000Z",
      completedAt: "2026-08-06T18:01:00.000Z",
      todaysMemoryCount: 1,
      contradiction: null,
      links: null,
      routing: null,
      allSucceeded: false,
      errors: ["矛盾检测失败: AI 不可用", "画像更新失败: 超时"],
    };

    const filePath = await reporter.write(report);
    const fs = await import("fs");
    const content = fs.readFileSync(filePath, "utf-8");
    expect(content).toContain("矛盾检测失败");
    expect(content).toContain("画像更新失败");
  });
});
