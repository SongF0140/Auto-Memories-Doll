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

import MemoryLibraryPage from "../app/(main)/memory/page";
import MemoryLibraryItem from "../components/memory/MemoryLibraryItem";
import type { MemoryRecord } from "../types/memory";

const memory: MemoryRecord = {
  id: "memory / 1",
  version: 1,
  source: "test",
  sourceType: "manual",
  title: "Test memory",
  titleZh: "测试记忆",
  content: "测试内容",
  summary: "Test summary",
  summaryZh: "测试摘要",
  tags: ["test"],
  topic: "project notes",
  createdAt: "2026-08-27T00:00:00.000Z",
  updatedAt: "2026-08-27T00:00:00.000Z",
  accessedAt: "2026-08-27T00:00:00.000Z",
  accessCount: 0,
  heatScore: 0,
  graphLinks: [],
};

describe("memory library page", () => {
  it("renders the library title and graph entry instead of the graph itself", () => {
    const html = renderToStaticMarkup(<MemoryLibraryPage />);

    expect(html).toContain("记忆检索库");
    expect(html).toContain('href="/memory/map"');
    expect(html).not.toContain("知识图谱加载失败");
  });

  it("links a memory card to its detail route and its topic route", () => {
    const html = renderToStaticMarkup(<MemoryLibraryItem memory={memory} />);

    expect(html).toContain('href="/memory/memory%20%2F%201"');
    expect(html).toContain('href="/memory/topic/project%20notes"');
  });
});
