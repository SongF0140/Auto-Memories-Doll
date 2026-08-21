import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const { watcherMemoryState } = vi.hoisted(() => ({
  watcherMemoryState: {
    memories: new Map<string, any>(),
    pending: [] as any[],
  },
}));

vi.mock("../server/services/memory-service", () => ({
  MemoryService: class {
    getMemory(id: string) {
      return watcherMemoryState.memories.get(id) || null;
    }

    stageCreateMemoryRecord(record: any) {
      watcherMemoryState.pending.push({
        eventId: `create-${watcherMemoryState.pending.length}`,
        memoryId: record.id,
        eventType: "create",
        candidate: JSON.stringify(record),
      });
      return record.id;
    }

    stageUpdateMemory(id: string, updates: any) {
      const candidate = { ...watcherMemoryState.memories.get(id), ...updates };
      watcherMemoryState.pending.push({
        eventId: `update-${watcherMemoryState.pending.length}`,
        memoryId: id,
        eventType: "update",
        candidate: JSON.stringify(candidate),
      });
      return `update-${id}`;
    }

    close() {}
  },
}));

import { ingestMarkdownFile } from "../server/watchers/file-watcher";
import { formatMemoryAsMarkdown } from "../lib/storage/markdown-formatter";
import { MemoryRecord } from "../types/memory";

const testDir = mkdtempSync(join(tmpdir(), "auto-memories-file-watcher-"));
const filePath = join(testDir, "external-memory.md");

function makeRecord(content: string): MemoryRecord {
  return {
    id: "external-memory-1",
    version: 1,
    source: filePath,
    sourceType: "manual",
    title: "外部文件",
    content,
    summary: "外部文件摘要",
    tags: ["external"],
    topic: "integration",
    createdAt: "2026-08-21T00:00:00.000Z",
    updatedAt: "2026-08-21T00:00:00.000Z",
    accessedAt: "2026-08-21T00:00:00.000Z",
    accessCount: 0,
    heatScore: 0,
    graphLinks: [],
  };
}

beforeEach(() => {
  watcherMemoryState.memories.clear();
  watcherMemoryState.pending.length = 0;
});

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe("FileWatcher external Markdown integration", () => {
  it("keeps one memory when an external file is added and then modified", async () => {
    writeFileSync(filePath, formatMemoryAsMarkdown(makeRecord("初始正文")), "utf-8");

    await ingestMarkdownFile(filePath, "add");
    const createEvent = watcherMemoryState.pending[0];
    const createCandidate = JSON.parse(createEvent.candidate) as MemoryRecord;
    expect(createEvent.eventType).toBe("create");
    expect(createEvent.memoryId).toBe("external-memory-1");

    watcherMemoryState.memories.set(createCandidate.id, createCandidate);
    watcherMemoryState.pending.length = 0;

    writeFileSync(filePath, formatMemoryAsMarkdown(makeRecord("外部修改后的正文")), "utf-8");
    await ingestMarkdownFile(filePath, "change");

    const updateEvents = watcherMemoryState.pending;
    expect(updateEvents).toHaveLength(1);
    expect(updateEvents[0].eventType).toBe("update");
    expect(updateEvents[0].memoryId).toBe("external-memory-1");
    expect([...watcherMemoryState.memories.values()]).toHaveLength(1);
    expect([...watcherMemoryState.memories.values()][0].id).toBe("external-memory-1");
  });

  it("derives the same stable memoryId for an id-less file across add and change", async () => {
    writeFileSync(filePath, "# 外部纯文本\n\n第一次写入的正文内容。", "utf-8");

    await ingestMarkdownFile(filePath, "add");
    const createEvent = watcherMemoryState.pending[0];
    const createCandidate = JSON.parse(createEvent.candidate) as MemoryRecord;
    expect(createEvent.memoryId).toMatch(/^file-[a-f0-9]{32}$/);

    watcherMemoryState.memories.set(createCandidate.id, createCandidate);
    watcherMemoryState.pending.length = 0;
    writeFileSync(filePath, "# 外部纯文本\n\n第二次修改后的正文内容。", "utf-8");

    await ingestMarkdownFile(filePath, "change");

    expect(watcherMemoryState.pending).toHaveLength(1);
    expect(watcherMemoryState.pending[0]).toMatchObject({
      eventType: "update",
      memoryId: createEvent.memoryId,
    });
    expect(watcherMemoryState.memories.size).toBe(1);
  });

  it("coalesces concurrent add and change events for the same file", async () => {
    writeFileSync(filePath, formatMemoryAsMarkdown(makeRecord("并发事件正文")), "utf-8");

    await Promise.all([
      ingestMarkdownFile(filePath, "add"),
      ingestMarkdownFile(filePath, "change"),
    ]);

    expect(watcherMemoryState.pending).toHaveLength(1);
    expect(watcherMemoryState.pending[0]).toMatchObject({
      eventType: "create",
      memoryId: "external-memory-1",
    });
  });
});
