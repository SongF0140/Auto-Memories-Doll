import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import MemoryMapViewport from "../components/memory/MemoryMapViewport";
import type { MemoryRecord } from "../types/memory";

const memory: MemoryRecord = {
  id: "memory-1",
  version: 1,
  source: "test",
  sourceType: "manual",
  title: "测试记忆",
  content: "测试内容",
  summary: "测试摘要",
  tags: ["test"],
  topic: "ai-coding",
  createdAt: "2026-08-27T00:00:00.000Z",
  updatedAt: "2026-08-27T00:00:00.000Z",
  accessedAt: "2026-08-27T00:00:00.000Z",
  accessCount: 0,
  heatScore: 0,
  graphLinks: [],
};

describe("memory map viewport", () => {
  it("renders an explicit empty state", () => {
    const html = renderToStaticMarkup(
      <MemoryMapViewport memories={[]} loading={false} error="" onNodeClick={vi.fn()} />,
    );

    expect(html).toContain("暂无知识图谱");
  });

  it("renders an explicit loading state", () => {
    const html = renderToStaticMarkup(
      <MemoryMapViewport memories={[]} loading={true} error="" onNodeClick={vi.fn()} />,
    );

    expect(html).toContain("正在加载知识图谱");
  });

  it("renders an explicit error state", () => {
    const html = renderToStaticMarkup(
      <MemoryMapViewport memories={[]} loading={false} error="请求失败" onNodeClick={vi.fn()} />,
    );

    expect(html).toContain("知识图谱加载失败");
    expect(html).toContain("请求失败");
  });

  it("renders the shared graph component when data is available", () => {
    const html = renderToStaticMarkup(
      <MemoryMapViewport memories={[memory]} loading={false} error="" onNodeClick={vi.fn()} />,
    );

    expect(html).toContain("搜索知识节点");
    expect(html).not.toContain("暂无知识图谱");
  });
});
