import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { MemoryRecord } from "../types/memory";

const generateMock = vi.hoisted(() => vi.fn());
vi.mock("../lib/ai/model-adapter", () => ({
  ModelAdapter: {
    isDegradedMode: false,
    generate: generateMock,
  },
}));

const notesRoot = mkdtempSync(join(tmpdir(), "amd-synthesis-"));
vi.mock("../lib/storage/path-resolver", () => ({
  getNotesPath: () => join(notesRoot, "notes"),
}));

const memoryServiceStub = vi.hoisted(() => ({
  listMemories: vi.fn(() => [] as MemoryRecord[]),
  createMemoryRecord: vi.fn(),
  updateMemory: vi.fn(),
  enqueueEvent: vi.fn(),
  close: vi.fn(),
}));
vi.mock("../server/services/memory-service", () => ({
  MemoryService: vi.fn(() => memoryServiceStub),
}));

import { SynthesisCompiler, computeSignature } from "../server/orchestrators/synthesis-compiler";
import { CompileVerifier } from "../server/orchestrators/compile-verifier";
import { MemoryService } from "../server/services/memory-service";
import { ModelAdapter } from "../lib/ai/model-adapter";

function makeMemory(id: string, overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id,
    version: 1,
    source: "test",
    sourceType: "manual",
    title: `标题 ${id}`,
    content: `正文 ${id}`,
    summary: `摘要 ${id}`,
    tags: ["t"],
    topic: "topic-a",
    createdAt: "2026-01-01",
    updatedAt: new Date().toISOString(),
    accessedAt: "2026-01-01",
    accessCount: 0,
    heatScore: 0,
    graphLinks: [],
    ...overrides,
  } as MemoryRecord;
}

function clusterOf(n: number, overrides: Partial<MemoryRecord> = {}): MemoryRecord[] {
  return Array.from({ length: n }, (_, i) => makeMemory(`m${i}`, overrides));
}

function okDraft(content = "综合结论正文") {
  return {
    content: JSON.stringify({
      title: "综合结论",
      summary: "一句话结论",
      content,
      tags: ["综合"],
    }),
    finishReason: "stop",
  };
}

beforeEach(() => {
  generateMock.mockReset();
  generateMock.mockResolvedValue(okDraft());
  memoryServiceStub.listMemories.mockReturnValue([]);
  memoryServiceStub.createMemoryRecord.mockReset();
  memoryServiceStub.updateMemory.mockReset();
  memoryServiceStub.enqueueEvent.mockReset();
  (ModelAdapter as unknown as { isDegradedMode: boolean }).isDegradedMode = false;
});

/** 可控的假验证器：把 WiCER 验证从编译器测试里解耦 */
function fakeVerifier(passed: boolean, missingFacts: string[] = []) {
  return {
    diagnose: vi.fn(async () => ({ passed, missingFacts, round: 1 })),
  };
}

describe("SynthesisCompiler.cluster（I-6 聚类）", () => {
  it("按 topic + wikilink 连通分量聚类，规模不足的簇不产出", () => {
    const compiler = new SynthesisCompiler();
    const memories = [...clusterOf(2, { topic: "small" }), ...clusterOf(5, { topic: "big" })];

    const clusters = compiler.cluster(memories);
    expect(clusters.map((c) => c.topic)).toEqual(["big"]);
    expect(clusters[0].memoryIds).toHaveLength(5);
  });

  it("同 topic 内被 wikilink 连通的卡聚成一个簇", () => {
    const compiler = new SynthesisCompiler();
    const memories = clusterOf(6, { topic: "linked" });
    memories[0].graphLinks = ["m1"];
    memories[1].graphLinks = ["m0"];

    const clusters = compiler.cluster(memories);
    expect(clusters).toHaveLength(1);
  });

  it("superseded 卡片不参与聚类", () => {
    const compiler = new SynthesisCompiler();
    const memories = [
      ...clusterOf(3, { topic: "a", status: "superseded" as const }),
      ...clusterOf(5, { topic: "b" }),
    ];
    expect(compiler.cluster(memories).map((c) => c.topic)).toEqual(["b"]);
  });
});

describe("SynthesisCompiler.compile（I-6 + I-7）", () => {
  it("验证通过时落盘综合卡，含 sources 与 compileSignature", async () => {
    const memories = clusterOf(5);
    memoryServiceStub.createMemoryRecord.mockResolvedValue("synthesis-x");

    const report = await new SynthesisCompiler(
      memoryServiceStub as unknown as MemoryService,
      fakeVerifier(true) as unknown as CompileVerifier,
    ).compile(memories);

    expect(report.clusters).toBe(1);
    expect(report.created).toHaveLength(1);
    expect(report.failed).toHaveLength(0);
    expect(memoryServiceStub.createMemoryRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "synthesis",
        sources: memories.map((m) => m.id),
        compileSignature: computeSignature(memories),
      }),
    );
    // 来源卡回写 synthesizedBy
    expect(memoryServiceStub.updateMemory).toHaveBeenCalledTimes(5);
  });

  it("来源卡集合未变更时命中增量缓存，跳过重编译", async () => {
    const memories = clusterOf(5);
    const existing = makeMemory("synthesis-existing", {
      topic: "topic-a",
      kind: "synthesis",
      compileSignature: computeSignature(memories),
    });
    memoryServiceStub.listMemories.mockReturnValue([existing]);

    const report = await new SynthesisCompiler().compile(memories);

    expect(report.skipped[0].reason).toContain("增量缓存");
    expect(generateMock).not.toHaveBeenCalled();
  });

  it("近 14 天无更新的簇跳过编译", async () => {
    const memories = clusterOf(5, { updatedAt: "2020-01-01" });
    const report = await new SynthesisCompiler().compile(memories);
    expect(report.skipped[0].reason).toContain("无更新");
    expect(generateMock).not.toHaveBeenCalled();
  });

  it("验证失败：至多 2 轮重编译，最终转 review 队列且不落盘", async () => {
    const memories = clusterOf(5);

    const report = await new SynthesisCompiler(
      memoryServiceStub as unknown as MemoryService,
      fakeVerifier(false, ["摘要 m0"]) as unknown as CompileVerifier,
    ).compile(memories);

    expect(report.created).toHaveLength(0);
    expect(report.failed).toHaveLength(1);
    expect(report.failed[0].reason).toContain("人工裁决");
    expect(memoryServiceStub.createMemoryRecord).not.toHaveBeenCalled();
    // 1 次编译 + 2 轮重编译 = 3 次编译调用（硬上限）
    const compileCalls = generateMock.mock.calls.filter((args: unknown[]) =>
      String(args[0]).includes("知识编译器"),
    );
    expect(compileCalls).toHaveLength(CompileVerifier.maxRounds + 1);
    // 失败簇进入 review 队列
    expect(memoryServiceStub.enqueueEvent).toHaveBeenCalledWith(
      expect.objectContaining({ status: "review" }),
    );
  });

  it("缺失事实会作为『必须保留』约束进入重编译 prompt（WiCER 精准诊断）", async () => {
    const memories = clusterOf(5);

    await new SynthesisCompiler(
      memoryServiceStub as unknown as MemoryService,
      fakeVerifier(false, ["摘要 m0", "摘要 m2"]) as unknown as CompileVerifier,
    ).compile(memories);

    const refineCall = generateMock.mock.calls.find((args: unknown[]) =>
      String(args[0]).includes("必须保留"),
    );
    expect(refineCall).toBeTruthy();
    expect(String(refineCall![0])).toContain("摘要 m0");
    expect(String(refineCall![0])).toContain("摘要 m2");
  });

  it("降级模式不调用模型", async () => {
    (ModelAdapter as unknown as { isDegradedMode: boolean }).isDegradedMode = true;
    const report = await new SynthesisCompiler().compile(clusterOf(5));
    expect(report.created).toHaveLength(0);
    expect(generateMock).not.toHaveBeenCalled();
  });
});

describe("CompileVerifier.diagnose（I-7）", () => {
  it("全部探针命中 → 通过且无缺失事实", async () => {
    generateMock.mockImplementation(async (prompt: unknown) => {
      const p = String(prompt);
      if (p.includes("只回复 YES 或 NO")) return { content: "YES", finishReason: "stop" };
      return { content: "核心事实是什么？", finishReason: "stop" };
    });

    const outcome = await new CompileVerifier().diagnose(
      { title: "t", summary: "s", content: "c", tags: [] },
      clusterOf(3),
    );
    expect(outcome.passed).toBe(true);
    expect(outcome.missingFacts).toHaveLength(0);
    // 每张来源卡 1 个探针 + 1 次判定
    expect(generateMock).toHaveBeenCalledTimes(6);
  });

  it("探针未命中 → 精准定位缺失事实（targeted diagnosis）", async () => {
    generateMock.mockImplementation(async (prompt: unknown) => {
      const p = String(prompt);
      if (p.includes("只回复 YES 或 NO")) return { content: "NO", finishReason: "stop" };
      return { content: "核心事实是什么？", finishReason: "stop" };
    });

    const sources = clusterOf(2);
    const outcome = await new CompileVerifier().diagnose(
      { title: "t", summary: "s", content: "c", tags: [] },
      sources,
    );
    expect(outcome.passed).toBe(false);
    expect(outcome.missingFacts).toEqual(sources.map((s) => s.summary));
  });

  it("探针调用异常时保守判为未命中，静默放行不如人工兜底", async () => {
    generateMock.mockRejectedValue(new Error("boom"));
    const outcome = await new CompileVerifier().diagnose(
      { title: "t", summary: "s", content: "c", tags: [] },
      clusterOf(2),
    );
    expect(outcome.passed).toBe(false);
  });
});
