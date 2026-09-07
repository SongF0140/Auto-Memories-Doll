import { describe, it, expect } from "vitest";
import { MemoryRecord } from "../types/memory";
import { formatInjectedMemory, KIND_INJECTION_HINTS } from "../features/chat/handler";

function makeMemory(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id: "m1",
    version: 1,
    source: "test",
    sourceType: "manual",
    title: "Memory Title",
    titleZh: "记忆标题",
    content: "正文第一段细节……正文第二段细节……",
    summary: "summary",
    summaryZh: "一句话摘要",
    tags: ["t1"],
    tagsZh: ["标签一"],
    topic: "topic-a",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    accessedAt: "2026-01-01",
    accessCount: 0,
    heatScore: 0,
    graphLinks: [],
    kind: "fact",
    ...overrides,
  } as MemoryRecord;
}

describe("formatInjectedMemory（检索注入带正文细节）", () => {
  it("预算 > 0 时正文进入注入内容", () => {
    const injected = formatInjectedMemory(makeMemory(), 2000);
    expect(injected).toContain("标题: 记忆标题");
    expect(injected).toContain("摘要: 一句话摘要");
    expect(injected).toContain("标签: 标签一");
    expect(injected).toContain("内容: 正文第一段细节");
  });

  it("预算为 0 时退化为仅摘要（预算耗尽后的靠后卡片）", () => {
    const injected = formatInjectedMemory(makeMemory(), 0);
    expect(injected).toContain("标题: 记忆标题");
    expect(injected).not.toContain("内容:");
  });

  it("正文超预算时截断并标注", () => {
    const long = "细节".repeat(2000); // 4000 字符
    const injected = formatInjectedMemory(makeMemory({ content: long }), 100);
    expect(injected).toContain("内容:");
    expect(injected).toContain("（正文超出预算被截断）");
    // 截断后的正文不超过预算 + 标注
    const body = injected.split("内容: ")[1] ?? "";
    expect(body.length).toBeLessThan(100 + 30);
  });

  it("inference 卡带来源提示（I-2 幻觉防护不回退）", () => {
    const injected = formatInjectedMemory(makeMemory({ kind: "inference" }), 500);
    expect(injected).toContain(KIND_INJECTION_HINTS.inference);
  });

  it("正文为空的卡片不输出空内容段", () => {
    const injected = formatInjectedMemory(makeMemory({ content: "  " }), 500);
    expect(injected).not.toContain("内容:");
  });
});
