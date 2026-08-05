import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const TEST_ROOT = join(tmpdir(), "amd-wiki-test-" + Date.now());

// 让 WikiGraph 的 getNotesPath 返回临时目录
vi.mock("../lib/storage/path-resolver", () => ({
  getNotesPath: () => TEST_ROOT,
  getTopicPath: (t: string) => join(TEST_ROOT, t),
}));

import { WikiGraph } from "../lib/graph/wiki-graph";

function makeMdFile(
  memoryId: string,
  title: string,
  tags: string[],
  related: string[],
  wikilinks: string[] = [],
): string {
  const tagsYaml = JSON.stringify(tags);
  const relatedYaml = JSON.stringify(related);
  const wikilinkLines = wikilinks.map((id) => `[[${id}]]`).join("\n");

  return `---
id: "${memoryId}"
title: "${title}"
topic: "test"
tags: ${tagsYaml}
related: ${relatedYaml}
version: 1
source: "test"
sourceType: "manual"
createdAt: "2026-01-01T00:00:00Z"
updatedAt: "2026-01-01T00:00:00Z"
accessedAt: "2026-01-01T00:00:00Z"
accessCount: 0
heatScore: 0
---

# ${title}

测试内容。

${wikilinkLines}
`;
}

function addFile(name: string, memoryId: string, title: string, tags: string[], related: string[], wikilinks: string[] = []) {
  writeFileSync(join(TEST_ROOT, name), makeMdFile(memoryId, title, tags, related, wikilinks), "utf-8");
}

beforeEach(() => {
  if (existsSync(TEST_ROOT)) rmSync(TEST_ROOT, { recursive: true, force: true });
  mkdirSync(TEST_ROOT, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_ROOT)) rmSync(TEST_ROOT, { recursive: true, force: true });
});

describe("WikiGraph — 索引与查询", () => {
  it("buildIndex parses files and getNeighbors returns links", async () => {
    addFile("m1.md", "m1", "记忆一", ["react"], ["m2"]);
    addFile("m2.md", "m2", "记忆二", ["state"], []);

    const graph = new WikiGraph();
    await graph.buildIndex();
    const neighbors = await graph.getNeighbors("m1");
    expect(neighbors).toContain("m2");
  });

  it("getNeighbors returns empty for isolated memory", async () => {
    addFile("m0.md", "m0", "孤立记忆", [], []);

    const graph = new WikiGraph();
    const neighbors = await graph.getNeighbors("m0");
    expect(neighbors).toHaveLength(0);
  });

  it("getOutgoingLinks returns frontmatter related + body wikilinks", async () => {
    addFile("m1.md", "m1", "记忆一", ["react"], ["m2"], ["m3"]);

    const graph = new WikiGraph();
    const outgoing = await graph.getOutgoingLinks("m1");
    expect(outgoing).toContain("m2");
    expect(outgoing).toContain("m3");
    expect(outgoing).not.toContain("m1"); // 不自引用
  });

  it("getIncomingLinks finds reverse references", async () => {
    addFile("m1.md", "m1", "记忆一", [], ["m3"]);
    addFile("m2.md", "m2", "记忆二", [], ["m3"]);
    addFile("m3.md", "m3", "被引用记忆", [], []);

    const graph = new WikiGraph();
    const incoming = await graph.getIncomingLinks("m3");
    expect(incoming).toHaveLength(2);
  });

  it("findPath returns BFS path", async () => {
    addFile("m1.md", "m1", "A", [], ["m2"]);
    addFile("m2.md", "m2", "B", [], ["m3"]);
    addFile("m3.md", "m3", "C", [], []);

    const graph = new WikiGraph();
    const paths = await graph.findPath("m1", "m3");
    expect(paths).not.toBeNull();
    expect(paths![0]).toEqual(["m1", "m2", "m3"]);
  });

  it("findPath returns null when no path", async () => {
    addFile("m1.md", "m1", "A", [], []);
    addFile("m2.md", "m2", "B", [], []);

    const graph = new WikiGraph();
    expect(await graph.findPath("m1", "m2")).toBeNull();
  });

  it("getStats reports correct counts", async () => {
    addFile("m1.md", "m1", "A", [], ["m2"]);
    addFile("m2.md", "m2", "B", [], []);
    addFile("m3.md", "m3", "C", [], []);

    const graph = new WikiGraph();
    const stats = await graph.getStats();
    expect(stats.totalNodes).toBe(3);
    expect(stats.totalEdges).toBe(1);
    expect(stats.orphans).toBe(2);
  });
});

describe("WikiGraph — 缓存", () => {
  it("second buildIndex uses cache when no files changed", async () => {
    addFile("m1.md", "m1", "A", [], []);
    const graph = new WikiGraph();

    await graph.buildIndex();
    // 修改文件让 mtime 变 → 第二次读取
    // 这里不修改文件，验证缓存复用：第二次应不报错且结果一致
    await graph.buildIndex(); // 应使用缓存
    const neighbors = await graph.getNeighbors("m1");
    expect(neighbors).toHaveLength(0);
  });

  it("invalidateCache forces re-read on next query", async () => {
    addFile("m1.md", "m1", "A", [], []);
    const graph = new WikiGraph();

    await graph.buildIndex();
    graph.invalidateCache();

    // 缓存失效后重新 build 不应报错
    await graph.buildIndex();
    const neighbors = await graph.getNeighbors("m1");
    expect(neighbors).toHaveLength(0);
  });

  it("addWikilinkToFile appends and invalidates", async () => {
    addFile("m1.md", "m1", "A", [], []);
    addFile("m2.md", "m2", "B", [], []);
    const graph = new WikiGraph();

    await graph.addWikilinkToFile(join(TEST_ROOT, "m1.md"), "m2");
    const neighbors = await graph.getNeighbors("m1");
    expect(neighbors).toContain("m2");
  });

  it("addWikilinkToFile does not duplicate", async () => {
    addFile("m1.md", "m1", "A", [], [], ["m2"]);
    const graph = new WikiGraph();

    await graph.addWikilinkToFile(join(TEST_ROOT, "m1.md"), "m2");
    const neighbors = await graph.getNeighbors("m1");
    // 不应重复添加
    expect(neighbors.filter((n) => n === "m2")).toHaveLength(1);
  });
});

describe("WikiGraph — 边界情况", () => {
  it("handles empty notes directory", async () => {
    const graph = new WikiGraph();
    const stats = await graph.getStats();
    expect(stats.totalNodes).toBe(0);
  });

  it("handles unparseable md files", async () => {
    writeFileSync(join(TEST_ROOT, "broken.md"), "不是合法 frontmatter\n无分隔符", "utf-8");
    addFile("m1.md", "m1", "A", [], []);

    const graph = new WikiGraph();
    const stats = await graph.getStats();
    expect(stats.totalNodes).toBe(1);
  });

  it("scanAllFiles lists md files", async () => {
    addFile("m1.md", "m1", "A", [], []);
    addFile("m2.md", "m2", "B", [], []);
    writeFileSync(join(TEST_ROOT, "notes.txt"), "not md", "utf-8");

    const graph = new WikiGraph();
    const files = await graph.scanAllFiles();
    expect(files.length).toBeGreaterThanOrEqual(2);
  });
});
