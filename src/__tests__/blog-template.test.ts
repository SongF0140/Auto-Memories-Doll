import { describe, it, expect } from "vitest";
import { MemoryRecord } from "../types/memory";
import {
  formatInjectedMemory,
  classifyMemoryToSection,
  buildBlogTemplateBlock,
  formatKnowledgeBrief,
  BLOG_SECTIONS,
  KIND_INJECTION_HINTS,
} from "../features/chat/blog-template";

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
    expect(injected).toContain("（正文超出预算被截断）");
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

describe("classifyMemoryToSection（知识分类归位）", () => {
  it("synthesis 卡归入「结论与建议」", () => {
    expect(classifyMemoryToSection(makeMemory({ kind: "synthesis" }))).toBe("conclusion");
  });

  it("含坑点/报错信号的卡归入「坑点与经验」", () => {
    const memory = makeMemory({
      summaryZh: "构建时 vite 报错 Port 3000 被占用的修复过程",
    });
    expect(classifyMemoryToSection(memory)).toBe("pitfalls");
  });

  it("含配置/命令信号的卡归入「实践步骤」", () => {
    const memory = makeMemory({
      summaryZh: "pnpm 安装依赖并配置 tsconfig 的操作记录",
    });
    expect(classifyMemoryToSection(memory)).toBe("practice");
  });

  it("含动机/原因信号的卡归入「背景与动机」", () => {
    const memory = makeMemory({
      titleZh: "为什么放弃 create-react-app",
      summaryZh: "因为 CRA 启动慢",
    });
    expect(classifyMemoryToSection(memory)).toBe("background");
  });

  it("无信号的事实卡默认归入「核心概念」", () => {
    expect(classifyMemoryToSection(makeMemory())).toBe("concept");
  });

  it("归位优先级：结论信号压过坑点信号", () => {
    const memory = makeMemory({
      kind: "synthesis",
      summaryZh: "踩坑总结",
    });
    expect(classifyMemoryToSection(memory)).toBe("conclusion");
  });
});

describe("buildBlogTemplateBlock（每次调用注入的模板）", () => {
  it("包含全部段落标题与排版要求", () => {
    const block = buildBlogTemplateBlock();
    for (const section of BLOG_SECTIONS.filter((s) => s.id !== "misc")) {
      expect(block).toContain(`【${section.title}】`);
      expect(block).toContain(section.guide.slice(0, 10));
    }
    expect(block).toContain("排版要求");
    expect(block).toContain("[来自记忆]");
    expect(block).toContain("不要编造");
  });
});

describe("formatKnowledgeBrief（素材按段落归位）", () => {
  it("记忆按模板段落分组，段落顺序与模板一致", () => {
    const memories = [
      makeMemory({ id: "why", titleZh: "为什么换构建工具", summaryZh: "因为启动慢" }),
      makeMemory({ id: "cfg", summaryZh: "pnpm 配置安装步骤" }),
      makeMemory({ id: "bug", summaryZh: "vite 报错修复教训" }),
      makeMemory({ id: "sum", kind: "synthesis", summaryZh: "整体结论" }),
      makeMemory({ id: "plain", summaryZh: "普通事实" }),
    ];
    const brief = formatKnowledgeBrief(memories, () => 0);

    const positions = ["背景与动机", "核心概念", "实践步骤", "坑点与经验", "结论与建议"].map(
      (title) => brief.indexOf(`#### ${title}`),
    );
    // 每个段落都出现且按模板顺序排列
    positions.forEach((pos) => expect(pos).toBeGreaterThan(-1));
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);

    expect(brief).toContain("why".length > 0 ? "为什么换构建工具" : "why");
    expect(brief).toContain("pnpm 配置安装步骤");
    expect(brief).toContain("vite 报错修复教训");
    expect(brief).toContain("整体结论");
    expect(brief).toContain("普通事实");
  });

  it("正文预算通过回调逐卡下发", () => {
    const memories = [makeMemory({ id: "a" }), makeMemory({ id: "b" })];
    const brief = formatKnowledgeBrief(memories, (m) => (m.id === "a" ? 500 : 0));

    expect(brief).toContain("内容: 正文第一段细节");
    // b 卡预算为 0：只有一处「内容:」（来自 a 卡）
    expect(brief.split("内容: ").length - 1).toBe(1);
  });

  it("没有素材的段落不输出空小节", () => {
    const brief = formatKnowledgeBrief([makeMemory({ id: "only" })], () => 0);
    expect(brief).toContain("#### 核心概念");
    expect(brief).not.toContain("#### 坑点与经验");
    expect(brief).not.toContain("#### 结论与建议");
  });
});
