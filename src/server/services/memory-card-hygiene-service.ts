import { MemoryRecord } from "../../types/memory";

export type MemoryCardHygieneIssue = "garbled" | "english" | "markdown" | "disfluent";

export type MemoryCardHygieneResult = {
  needsOptimization: boolean;
  issues: MemoryCardHygieneIssue[];
};

const OPTIMIZATION_TAG = "旧记忆优化";

const GARBLE_PATTERN = /[\uFFFD�]|\?{3,}|(?:Ã|Â|â)[\w\p{P}\p{S}]*/u;
const BAD_HEADING_PATTERN = /^#{1,6}[^#\s]/m;
const BAD_LIST_PATTERN = /^\s*[-*+]\S/m;
const CJK_PATTERN = /[\u3400-\u9FFF]/g;
const ASCII_WORD_PATTERN = /[A-Za-z]{3,}/g;

function isIllegalControlChar(char: string): boolean {
  const code = char.charCodeAt(0);
  return (code >= 0 && code <= 8) || code === 11 || code === 12 || (code >= 14 && code <= 31);
}

function hasIllegalControlChar(text: string): boolean {
  return [...text].some(isIllegalControlChar);
}

function stripIllegalControlChars(text: string): string {
  return [...text].filter((char) => !isIllegalControlChar(char)).join("");
}

export class MemoryCardHygieneService {
  static readonly optimizationTag = OPTIMIZATION_TAG;

  inspect(memory: MemoryRecord): MemoryCardHygieneResult {
    const text = this.cardText(memory);
    const issues = new Set<MemoryCardHygieneIssue>();

    if (GARBLE_PATTERN.test(text) || hasIllegalControlChar(text)) {
      issues.add("garbled");
    }

    if (this.isMostlyEnglishNarrative(memory)) {
      issues.add("english");
    }

    if (BAD_HEADING_PATTERN.test(memory.content) || BAD_LIST_PATTERN.test(memory.content)) {
      issues.add("markdown");
    }

    if (this.isDisfluent(text)) {
      issues.add("disfluent");
    }

    return { needsOptimization: issues.size > 0, issues: [...issues] };
  }

  buildFallbackOptimization(memory: MemoryRecord, issues: MemoryCardHygieneIssue[]): MemoryRecord {
    const cleanedTitle = this.cleanInlineText(memory.title);
    const cleanedSummary = this.cleanInlineText(memory.summary);
    const cleanedContent = this.cleanMarkdown(memory.content);
    const tags = [
      ...new Set([...memory.tags, OPTIMIZATION_TAG, ...issues.map((issue) => `修复-${issue}`)]),
    ];

    return {
      ...memory,
      title: cleanedTitle || "旧记忆卡片优化",
      titleZh: cleanedTitle || "旧记忆卡片优化",
      summary: cleanedSummary || "已清理旧记忆卡片的乱码、格式和表达问题。",
      summaryZh: cleanedSummary || "已清理旧记忆卡片的乱码、格式和表达问题。",
      content: cleanedContent || "旧记忆卡片内容存在严重格式问题，已转为待人工复核的清理候选。",
      tags,
      tagsZh: tags,
    };
  }

  isOptimizationCandidate(memory: MemoryRecord): boolean {
    return (
      memory.tags.includes(OPTIMIZATION_TAG) || memory.tagsZh?.includes(OPTIMIZATION_TAG) === true
    );
  }

  private cardText(memory: MemoryRecord): string {
    return [memory.title, memory.summary, memory.content, memory.tags.join(" ")].join("\n");
  }

  private isMostlyEnglishNarrative(memory: MemoryRecord): boolean {
    const text = [memory.title, memory.summary, memory.content].join("\n");
    const cjkCount = text.match(CJK_PATTERN)?.length ?? 0;
    const englishWords = text.match(ASCII_WORD_PATTERN)?.length ?? 0;

    return englishWords >= 8 && cjkCount < 12;
  }

  private isDisfluent(text: string): boolean {
    return /(.)\1{5,}/.test(text) || /([。！？!?])\1{2,}/.test(text) || /\S{220,}/.test(text);
  }

  private cleanInlineText(text: string): string {
    return stripIllegalControlChars(text)
      .replace(/[\uFFFD�]/g, "")
      .replace(/\?{3,}/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  private cleanMarkdown(content: string): string {
    return stripIllegalControlChars(content)
      .replace(/[\uFFFD�]/g, "")
      .replace(/\?{3,}/g, "")
      .replace(/^(#{1,6})([^#\s])/gm, "$1 $2")
      .replace(/^(\s*[-*+])(\S)/gm, "$1 $2")
      .replace(/[ \t]+$/gm, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }
}
