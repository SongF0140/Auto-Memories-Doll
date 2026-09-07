import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, existsSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

process.env.MEMORY_ROOT = join(mkdtempSync(join(tmpdir(), "amd-control-plane-")), "memory-root");
process.env.VECTOR_BACKEND = "js";

import { ControlPlaneService, estimateTokens } from "../server/services/control-plane-service";
import { CONTROL_PLANE_FILES } from "../config/constants";
import { getMemoryRoot } from "../lib/storage/path-resolver";
import { MemoryRecord } from "../types/memory";

let tempRoot: string;

/** 清空控制面文件，保证用例之间互不泄漏 */
function cleanControlPlaneFiles(): void {
  for (const name of CONTROL_PLANE_FILES) {
    rmSync(join(tempRoot, name), { force: true });
  }
}

function makeMemory(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id: "m1",
    version: 1,
    source: "test",
    sourceType: "manual",
    title: "标题",
    content: "正文",
    summary: "摘要内容，用于索引展示",
    summaryZh: "中文摘要内容",
    tags: ["t"],
    topic: "topic-a",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    accessedAt: "2026-01-01",
    accessCount: 0,
    heatScore: 0,
    graphLinks: [],
    ...overrides,
  } as MemoryRecord;
}

beforeEach(async () => {
  // 以 path-resolver 的真实缓存路径为准，避免与测试自建临时目录不一致
  tempRoot = getMemoryRoot();
  mkdirSync(tempRoot, { recursive: true });
  cleanControlPlaneFiles();
  // review_q 直接读 pending_events / conflict_records，先建表
  const { MemoryService } = await import("../server/services/memory-service");
  new MemoryService();
});

describe("ControlPlaneService（I-5）", () => {
  it("writeAll 生成四个控制面文件", async () => {
    const service = new ControlPlaneService();
    const written = await service.writeAll({ memories: [makeMemory()] });

    expect(written.sort()).toEqual([...CONTROL_PLANE_FILES].sort());
    for (const name of CONTROL_PLANE_FILES) {
      expect(existsSync(join(tempRoot, name))).toBe(true);
    }
  });

  it("index.md 含话题、卡片数、最近更新与摘要", () => {
    const service = new ControlPlaneService();
    const index = service.buildIndex([
      makeMemory({ topic: "ai-coding", updatedAt: "2026-03-01" }),
      makeMemory({ id: "m2", topic: "ai-coding", updatedAt: "2026-02-01" }),
    ]);

    expect(index).toContain("ai-coding");
    expect(index).toContain("卡片数：2");
    expect(index).toContain("2026-03-01");
    expect(index).toContain("中文摘要内容");
  });

  it("overview.md 分节给出当前结论、已知矛盾与开放问题", () => {
    const service = new ControlPlaneService();
    const overview = service.buildOverview({
      memories: [makeMemory({ kind: "synthesis", sources: ["a", "b"] })],
      contradictions: [
        {
          memoryA: { id: "a", title: "A", summary: "sa" },
          memoryB: { id: "b", title: "B", summary: "sb" },
          description: "说法冲突",
          severity: "high",
          suggestion: "人工裁决",
        },
      ],
      lintIssues: [{ type: "dead-link", from: "a", to: "ghost" }],
      synthesis: {
        clusters: 1,
        created: [],
        skipped: [],
        failed: [{ topic: "t", reason: "验证未通过" }],
      },
    });

    expect(overview).toContain("## 当前结论");
    expect(overview).toContain("## 已知矛盾");
    expect(overview).toContain("说法冲突");
    expect(overview).toContain("## 开放问题");
    expect(overview).toContain("死链");
    expect(overview).toContain("编译验证未通过");
  });

  it("review_q.md 汇总 review 事件与 pending 冲突", async () => {
    const { getDatabase } = await import("../lib/storage/database");
    const db = getDatabase();
    db.exec(`
      INSERT INTO pending_events (eventId, memoryId, sourceType, candidate, changedFields, createdAt, status, retryCount)
      VALUES ('evt-1', 'mem-1', 'chat', '{}', '[]', '2026-01-01', 'review', 0)
    `);
    db.exec(`
      INSERT INTO conflict_records (conflictId, memoryId, eventId, field, existingValue, candidateValue, status, createdAt)
      VALUES ('conf-1', 'mem-1', 'evt-1', 'content', '"a"', '"b"', 'pending', '2026-01-01')
    `);

    const review = new ControlPlaneService().buildReviewQueue();
    expect(review).toContain("evt-1");
    expect(review).toContain("conf-1");
  });

  it("readIndexBrief 超预算时按 token 硬上限截断", () => {
    const service = new ControlPlaneService();
    const long = Array.from({ length: 200 }, (_, i) => `## 话题-${i}\n- 卡片数：${i}`).join("\n");
    writeFileSync(join(tempRoot, "index.md"), long, "utf-8");

    const brief = service.readIndexBrief(500);
    expect(estimateTokens(brief)).toBeLessThanOrEqual(500);
    expect(brief).toContain("截断");
  });

  it("estimateTokens 对中文更保守（约 1 字符/token）", () => {
    expect(estimateTokens("一二三四五")).toBe(5);
    expect(estimateTokens("abcdefgh")).toBe(2);
  });

  it("index.md 不存在时返回空串", () => {
    rmSync(join(tempRoot, "index.md"), { force: true });
    expect(new ControlPlaneService().readIndexBrief()).toBe("");
  });
});
