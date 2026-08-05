import { describe, it, expect } from "vitest";
import { deduplicateMemories, detectDuplicates } from "../server/pipelines/deduplicator";
import { formatMemoryContent, formatSummary, formatMemoryToMarkdown } from "../server/pipelines/formatter";
import { splitText } from "../server/pipelines/splitter";
import { extractTags } from "../server/pipelines/json-pipeline";

// ═══════════════════════════════════════════════════════════════
// Deduplicator
// ═══════════════════════════════════════════════════════════════

describe("deduplicateMemories", () => {
  it("完全相同内容返回 duplicate id", () => {
    const ids = deduplicateMemories([
      { id: "a", content: "hello world" },
      { id: "b", content: "hello world" },
    ]);
    expect(ids).toEqual(["b"]);
  });

  it("内容经标准化后相同的标记为重复", () => {
    const ids = deduplicateMemories([
      { id: "a", content: "Hello, World!" },
      { id: "b", content: "hello world" },
    ]);
    expect(ids).toEqual(["b"]);
  });

  it("不同内容不应标记为重复", () => {
    const ids = deduplicateMemories([
      { id: "a", content: "apple" },
      { id: "b", content: "banana" },
    ]);
    expect(ids).toEqual([]);
  });

  it("三个中有两个相同时只标记后出现的", () => {
    const ids = deduplicateMemories([
      { id: "a", content: "x" },
      { id: "b", content: "y" },
      { id: "c", content: "x" },
    ]);
    expect(ids).toEqual(["c"]);
  });

  it("空数组返回空", () => {
    expect(deduplicateMemories([])).toEqual([]);
  });
});

describe("detectDuplicates", () => {
  it("高相似度内容检测为重复", () => {
    // Jaccard ≈ 0.905: 19 公共 / 21 union (20 词 each, 1 diff)
    const result = detectDuplicates(
      "a b c d e f g h i j k l m n o p q r s u",
      ["a b c d e f g h i j k l m n o p q r s t"],
    );
    expect(result.isDuplicate).toBe(true);
    expect(result.similarity).toBeGreaterThan(0.9);
  });

  it("完全不同内容不重复", () => {
    const result = detectDuplicates("apple banana", [
      "zebra xylophone",
    ]);
    expect(result.isDuplicate).toBe(false);
  });

  it("existingContents 为空时不重复", () => {
    const result = detectDuplicates("hello", []);
    expect(result.isDuplicate).toBe(false);
  });

  it("标准化后比较", () => {
    const result = detectDuplicates("Hello, World!", [
      "hello world",
    ]);
    expect(result.isDuplicate).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// Formatter
// ═══════════════════════════════════════════════════════════════

describe("formatMemoryContent", () => {
  it("去除首尾空白", () => {
    expect(formatMemoryContent("  hello  ")).toBe("hello");
  });

  it("压缩多个空行为双空行", () => {
    const input = "line1\n\n\n\nline2";
    expect(formatMemoryContent(input)).toBe("line1\n\nline2");
  });

  it("\\r\\n 转为 \\n", () => {
    expect(formatMemoryContent("a\r\nb")).toBe("a\nb");
  });

  it("压缩连续空格", () => {
    expect(formatMemoryContent("a    b")).toBe("a b");
  });
});

describe("formatSummary", () => {
  it("短内容直接返回", () => {
    expect(formatSummary("short text")).toBe("short text");
  });

  it("超长时截断加省略号", () => {
    const long = "a".repeat(300);
    const result = formatSummary(long, 200);
    expect(result.length).toBeLessThanOrEqual(200);
    expect(result.endsWith("...")).toBe(true);
  });

  it("截断在句子边界", () => {
    const text = "a".repeat(120) + ". Some more text here.";
    const result = formatSummary(text, 150);
    expect(result.endsWith(".")).toBe(true);
    expect(result.length).toBeLessThan(200);
  });

  it("中文句号作为截断边界", () => {
    // 「。」在 maxLength 内能被找到 —— 50 chars 处
    const prefix = "a".repeat(60);
    const text = prefix + "。some more text that goes beyond the limit here";
    const result = formatSummary(text, 80);
    expect(result.endsWith("。")).toBe(true);
    expect(result.length).toBeLessThan(200);
  });
});

describe("formatMemoryToMarkdown", () => {
  it("输出包含 frontmatter 和标题", () => {
    const record = {
      id: "mem-99",
      version: 3,
      source: "test",
      sourceType: "manual" as const,
      title: "Test",
      summary: "Summary text",
      content: "Content text",
      tags: ["tag-a"],
      topic: "tech",
      graphLinks: ["link-1"],
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
      accessedAt: "2026-01-01",
      accessCount: 5,
      heatScore: 0.75,
    };
    const md = formatMemoryToMarkdown(record);
    expect(md).toContain("id: mem-99");
    expect(md).toContain("version: 3");
    expect(md).toContain("# Test");
    expect(md).toContain("Summary text");
    expect(md).toContain("Content text");
    expect(md).toContain("[link-1]");
  });
});

// ═══════════════════════════════════════════════════════════════
// Splitter
// ═══════════════════════════════════════════════════════════════

describe("splitText", () => {
  it("短文本不拆分", () => {
    const chunks = splitText("hello world", 1000);
    expect(chunks).toEqual(["hello world"]);
  });

  it("按段落双空行拆分", () => {
    const text = "paragraph one\n\nparagraph two";
    const chunks = splitText(text, 15);
    expect(chunks.length).toBe(2);
    expect(chunks[0]).toBe("paragraph one");
    expect(chunks[1]).toBe("paragraph two");
  });

  it("超长段落强制拆分", () => {
    const text = "a".repeat(2000);
    const chunks = splitText(text, 1000);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });

  it("空文本返回空数组", () => {
    expect(splitText("")).toEqual([]);
  });

  it("多段落按最大 chunk 尺寸合并", () => {
    const text = "a\n\nb\n\nc";
    const chunks = splitText(text, 10);
    expect(chunks.length).toBeLessThanOrEqual(3);
  });
});

// ═══════════════════════════════════════════════════════════════
// Tag extraction (from json-pipeline)
// ═══════════════════════════════════════════════════════════════

describe("extractTags", () => {
  it("提取 # 开头的标签", () => {
    const tags = extractTags("this is about #react #typescript");
    expect(tags).toContain("react");
    expect(tags).toContain("typescript");
  });

  it("过滤过短的标签", () => {
    const tags = extractTags("#a #hi #react");
    expect(tags).not.toContain("a");
    expect(tags).not.toContain("hi");
    expect(tags).toContain("react");
  });

  it("标签去重", () => {
    const tags = extractTags("#react #react #react");
    expect(tags).toEqual(["react"]);
  });

  it("最多取 5 个标签", () => {
    const tags = extractTags("#a1 #a2 #a3 #a4 #a5 #a6 #a7");
    expect(tags.length).toBeLessThanOrEqual(5);
  });

  it("文本无标签时返回空数组", () => {
    expect(extractTags("plain text")).toEqual([]);
  });
});
