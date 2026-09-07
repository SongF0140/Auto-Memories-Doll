import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

process.env.MEMORY_ROOT = join(mkdtempSync(join(tmpdir(), "amd-supersession-")), "memory-root");
process.env.VECTOR_BACKEND = "js";

import { MemoryService } from "../server/services/memory-service";
import { MemoryRecord } from "../types/memory";
import { formatMemoryAsMarkdown } from "../lib/storage/markdown-formatter";
import { parseMemoryFromText } from "../lib/storage/markdown-parser";

let service: MemoryService;
let tempRoot: string;

beforeEach(() => {
  tempRoot = process.env.MEMORY_ROOT!;
  service = new MemoryService();
});

afterEach(() => {
  service.close();
  try {
    rmSync(tempRoot, { recursive: true, force: true });
  } catch {
    /* Windows EBUSY 容忍 */
  }
});

async function create(id: string, content: string): Promise<MemoryRecord> {
  const record = {
    id,
    version: 1,
    source: "test",
    sourceType: "manual" as const,
    title: `标题 ${id}`,
    content,
    summary: `摘要 ${id}`,
    tags: ["t"],
    topic: "topic-a",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    accessedAt: "2026-01-01",
    accessCount: 0,
    heatScore: 0,
    graphLinks: [],
    status: "active" as const,
  };
  await service.createMemoryRecord(record);
  return record;
}

describe("Supersession 取代链（I-3）", () => {
  it("标记 superseded 后默认检索不返回，includeSuperseded 可查", async () => {
    await create("f-a", "旧主张");
    const superseding = {
      ...(await service.getMemory("f-a"))!,
      id: "f-b",
      supersedes: "f-a",
      status: "active" as const,
      graphLinks: [],
    };
    await service.createMemoryRecord(superseding);
    service.updateMemory("f-a", { status: "superseded", supersededBy: "f-b" });

    const ids = service.listMemories().map((m) => m.id);
    expect(ids).toContain("f-b");
    expect(ids).not.toContain("f-a");

    const allIds = service.listMemories({ includeSuperseded: true }).map((m) => m.id);
    expect(allIds).toContain("f-a");
    expect(allIds).toContain("f-b");
  });

  it("getSupersessionChain 沿 supersedes / supersededBy 双向遍历 A→B→C", async () => {
    await create("s-a", "v1");
    await create("s-b", "v2");
    await create("s-c", "v3");

    service.updateMemory("s-b", { supersedes: "s-a" });
    service.updateMemory("s-c", { supersedes: "s-b" });
    service.updateMemory("s-a", { status: "superseded", supersededBy: "s-b" });
    service.updateMemory("s-b", { status: "superseded", supersededBy: "s-c" });

    const chain = service.getSupersessionChain("s-b");
    expect(chain.map((m) => m.id)).toEqual(["s-a", "s-b", "s-c"]);
  });

  it("schema 迁移幂等：重复实例化不报错、存量数据保留", async () => {
    await create("persist", "内容");
    const again = new MemoryService();
    expect(again.getMemory("persist")?.content).toBe("内容");
    again.close();

    const third = new MemoryService();
    expect(third.getMemory("persist")?.content).toBe("内容");
    third.close();
  });
});

describe("front matter round-trip（F-3 / v2 字段）", () => {
  it("accessedAt / accessCount 不再丢失（此前 formatter 不写、parser 却读）", () => {
    const record = {
      id: "rt",
      version: 1,
      source: "test",
      sourceType: "manual" as const,
      title: "标题",
      content: "正文",
      summary: "摘要",
      tags: ["t"],
      topic: "topic-a",
      createdAt: "2026-01-01",
      updatedAt: "2026-01-02",
      accessedAt: "2026-01-03",
      accessCount: 7,
      heatScore: 0.4,
      graphLinks: [],
    } as MemoryRecord;

    const parsed = parseMemoryFromText(formatMemoryAsMarkdown(record))!;
    expect(parsed.accessedAt).toBe("2026-01-03");
    expect(parsed.accessCount).toBe(7);
  });

  it("v2 生命周期与编译溯源字段可完整往返", () => {
    const record = {
      id: "syn-1",
      version: 1,
      source: "nightly-synthesis",
      sourceType: "manual" as const,
      kind: "synthesis" as const,
      title: "综合",
      content: "综合正文",
      summary: "综合摘要",
      tags: ["t"],
      topic: "topic-a",
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
      accessedAt: "2026-01-01",
      accessCount: 0,
      heatScore: 0,
      graphLinks: [],
      status: "superseded" as const,
      supersededBy: "syn-2",
      supersedes: "syn-0",
      confidence: 0.812,
      windowUse: "当用户问 X 时有用",
      sources: ["a", "b"],
      synthesizedBy: "syn-3",
      compileSignature: "abc123",
    } as MemoryRecord;

    const parsed = parseMemoryFromText(formatMemoryAsMarkdown(record))!;
    expect(parsed.status).toBe("superseded");
    expect(parsed.supersededBy).toBe("syn-2");
    expect(parsed.supersedes).toBe("syn-0");
    expect(parsed.confidence).toBeCloseTo(0.812, 5);
    expect(parsed.windowUse).toBe("当用户问 X 时有用");
    expect(parsed.sources).toEqual(["a", "b"]);
    expect(parsed.synthesizedBy).toBe("syn-3");
    expect(parsed.compileSignature).toBe("abc123");
  });

  it("active 状态与可选字段不写入 front matter（保持文件干净）", () => {
    const record = {
      id: "plain",
      version: 1,
      source: "test",
      sourceType: "manual" as const,
      title: "标题",
      content: "正文",
      summary: "摘要",
      tags: ["t"],
      topic: "topic-a",
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
      accessedAt: "2026-01-01",
      accessCount: 0,
      heatScore: 0,
      graphLinks: [],
    } as MemoryRecord;

    const markdown = formatMemoryAsMarkdown(record);
    expect(markdown).not.toContain("status:");
    expect(markdown).not.toContain("supersededBy:");
    expect(markdown).not.toContain("confidence:");
    expect(markdown).not.toContain("sources:");
  });
});

describe("incrementAccess / incrementRetrieval（I-4 + I-9）", () => {
  it("用户点击强化置信度，自动检索只累加弱信号", async () => {
    await create("i-acc", "内容");
    service.updateMemory("i-acc", { confidence: 0.5, retrievalCount: 0 });

    service.incrementAccess("i-acc");
    service.incrementRetrieval(["i-acc"]);

    const memory = service.getMemory("i-acc")!;
    expect(memory.accessCount).toBe(1);
    expect(memory.confidence).toBeCloseTo(0.55, 5);
    expect(memory.retrievalCount).toBe(1);
    // 归零弱信号，避免影响后续衰减断言
    service.updateMemory("i-acc", { retrievalCount: 0 });
  });

  it("incrementRetrieval 空列表是 no-op 且不动 accessCount", async () => {
    await create("i-noop", "内容");
    service.incrementRetrieval([]);
    expect(service.getMemory("i-noop")!.accessCount).toBe(0);
  });

  it("retrievalCount 支持日衰减且 accessCount 不衰减", async () => {
    await create("i-decay", "内容");
    service.incrementRetrieval(["i-decay"]);
    service.incrementRetrieval(["i-decay"]);
    service.incrementRetrieval(["i-decay"]);
    expect(service.getMemory("i-decay")!.retrievalCount).toBe(3);

    // SQLite CAST 对 REAL → INTEGER 向零截断：3 * 0.5 = 1.5 → 1
    expect(service.decayRetrievalCounts(0.5)).toBe(1);
    expect(service.getMemory("i-decay")!.retrievalCount).toBe(1);
    // 1 * 0.5 = 0.5 → 0（弱信号会被衰减干净，accessCount 不受影响）
    expect(service.decayRetrievalCounts(0.5)).toBe(1);
    expect(service.getMemory("i-decay")!.retrievalCount).toBe(0);
    expect(service.getMemory("i-decay")!.accessCount).toBe(0);
  });
});
