import { MemoryRecord } from "../../types/memory";

/**
 * 博客写作模板与知识归位（修复"检索记忆只有平铺摘要、写博客时不知道细节放哪"）：
 *
 * - 每次调用都注入一份固定模板：定义知识分类（段落）与讲解排版格式
 * - 检索到的记忆按规则归位到对应段落（零 LLM 成本），模型把
 *   「对应类型的知识点放在该放的地方」即可成文
 *
 * 归位是启发式的：按 kind + 关键词信号判定，允许同一张卡只落一个段落，
 * 落错的代价由「其他素材」兜底——宁可选错段也不要丢素材。
 */

export type BlogSectionId =
  "background" | "concept" | "practice" | "pitfalls" | "conclusion" | "misc";

export type BlogSection = {
  id: BlogSectionId;
  title: string;
  guide: string;
};

/** 模板段落：顺序即成文顺序（misc 永远排最后，仅兜底） */
export const BLOG_SECTIONS: BlogSection[] = [
  {
    id: "background",
    title: "背景与动机",
    guide: "为什么写这篇：问题场景、痛点、决策原因",
  },
  {
    id: "concept",
    title: "核心概念",
    guide: "需要先讲清的定义、术语、机制原理、对比关系",
  },
  {
    id: "practice",
    title: "实践步骤",
    guide: "配置、命令、代码、操作顺序；代码与标识符保留原文",
  },
  {
    id: "pitfalls",
    title: "坑点与经验",
    guide: "报错、失败、踩坑、修复过程与教训",
  },
  {
    id: "conclusion",
    title: "结论与建议",
    guide: "结论、适用条件、后续计划",
  },
  {
    id: "misc",
    title: "其他素材",
    guide: "未归入以上段落的补充素材，按需取用",
  },
];

/** 归位信号：按优先级依次匹配，先命中先归位 */
const SECTION_SIGNALS: Array<{ id: BlogSectionId; patterns: RegExp[] }> = [
  {
    id: "conclusion",
    patterns: [/总结/, /结论/, /综述/, /要点回顾/],
  },
  {
    id: "pitfalls",
    patterns: [
      /踩坑/,
      /坑点/,
      /报错/,
      /失败/,
      /修复/,
      /教训/,
      /异常/,
      /排查/,
      /bug/i,
      /error/i,
      /fix/i,
    ],
  },
  {
    id: "practice",
    patterns: [
      /配置/,
      /安装/,
      /命令/,
      /步骤/,
      /操作/,
      /部署/,
      /脚本/,
      /参数/,
      /设置/,
      /```/,
      /npm /i,
      /pnpm/i,
    ],
  },
  {
    id: "background",
    patterns: [/背景/, /动机/, /场景/, /痛点/, /需求/, /目标/, /为什么/, /原因/, /因为/],
  },
];

/**
 * 把一条记忆归位到模板段落（纯规则，零 LLM）。
 * 信号源：kind 优先（synthesis 必然是结论），其次标题/摘要/windowUse/标签/正文前段的词面信号。
 */
export function classifyMemoryToSection(memory: MemoryRecord): BlogSectionId {
  if (memory.kind === "synthesis") return "conclusion";

  const haystack = [
    memory.titleZh || memory.title,
    memory.summaryZh || memory.summary,
    memory.windowUse,
    (memory.tagsZh && memory.tagsZh.length > 0 ? memory.tagsZh : memory.tags).join(" "),
    (memory.content ?? "").slice(0, 1200),
  ]
    .filter(Boolean)
    .join("\n");

  for (const signal of SECTION_SIGNALS) {
    if (signal.patterns.some((pattern) => pattern.test(haystack))) return signal.id;
  }
  return "concept";
}

/** 每次调用注入的博客模板（固定文本，定义知识分类与讲解排版格式） */
export function buildBlogTemplateBlock(): string {
  const body = BLOG_SECTIONS.filter((section) => section.id !== "misc");
  const lines: string[] = [
    "## 博客写作模板",
    "",
    "写博客、教程、报告、总结类长文时，按下面的结构排版；下方「知识素材」已按段落归位，把对应素材写进对应小节：",
    "",
  ];
  body.forEach((section, index) => {
    lines.push(`${index + 1}. 【${section.title}】${section.guide}`);
  });
  lines.push(
    "",
    "排版要求：",
    "- 小节按需取舍：没有素材支撑的小节直接跳过，不要编造",
    "- 每个知识点展开成完整段落：保留数字、配置值、代码原文；代码块保留原始标识符，叙述用中文",
    "- 段落之间要有过渡衔接，不能写成素材罗列",
    "- 引用素材时标注 [来自记忆]",
  );
  return lines.join("\n");
}

/** I-2 幻觉防护（注入侧）：非事实类卡片在上下文中显式标注来源性质 */
export const KIND_INJECTION_HINTS: Record<string, string> = {
  inference: "（AI 推断，未经证实）",
  hypothesis: "（假设，待验证）",
  insight: "（洞察，主观判断）",
  synthesis: "（多来源综合结论）",
};

/** 渲染单条素材：标题（带性质提示）/ 摘要 / 标签 / 正文（受预算控制） */
export function formatInjectedMemory(memory: MemoryRecord, contentBudget = 0): string {
  const title = memory.titleZh || memory.title;
  const summary = memory.summaryZh || memory.summary;
  const tags = memory.tagsZh && memory.tagsZh.length > 0 ? memory.tagsZh : memory.tags;
  const hint = KIND_INJECTION_HINTS[memory.kind ?? "fact"] ?? "";

  const lines = [`标题: ${title}${hint}`, `摘要: ${summary}`, `标签: ${tags.join(", ")}`];

  // 正文进上下文：只有摘要时模型写长文（博客/报告）会丢掉全部细节
  const content = (memory.content ?? "").trim();
  if (contentBudget > 0 && content.length > 0) {
    lines.push(
      content.length > contentBudget
        ? `内容: ${content.slice(0, contentBudget)}…（正文超出预算被截断）`
        : `内容: ${content}`,
    );
  }

  return lines.join("\n");
}

/**
 * 把检索到的记忆按模板段落归位渲染。
 * contentBudgetFor 返回该卡可用的正文字符预算（0 = 仅摘要）。
 */
export function formatKnowledgeBrief(
  memories: MemoryRecord[],
  contentBudgetFor: (memory: MemoryRecord) => number,
): string {
  const grouped = new Map<BlogSectionId, MemoryRecord[]>();
  for (const memory of memories) {
    const sectionId = classifyMemoryToSection(memory);
    grouped.set(sectionId, [...(grouped.get(sectionId) ?? []), memory]);
  }

  const lines: string[] = ["### 知识素材（已按模板段落归位，写进对应小节即可）"];
  for (const section of BLOG_SECTIONS) {
    const items = grouped.get(section.id);
    if (!items || items.length === 0) continue;
    lines.push("", `#### ${section.title}`, `> ${section.guide}`);
    for (const memory of items) {
      lines.push("", formatInjectedMemory(memory, contentBudgetFor(memory)));
    }
  }

  return lines.join("\n");
}
