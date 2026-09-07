import { writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { MemoryRecord } from "../../types/memory";
import { getDatabase } from "../../lib/storage/database";
import { getMemoryRoot } from "../../lib/storage/path-resolver";
import { LintIssue } from "./structure-lint-service";
import { ContradictionItem } from "../orchestrators/contradiction-detector";
import { SynthesisReport } from "../orchestrators/synthesis-compiler";
import { CONTROL_PLANE_FILES, CONTROL_PLANE_TOKEN_BUDGET } from "../../config/constants";
import { logger } from "../../lib/logger";

/**
 * 控制面服务（I-5，LLM Wiki §运行控制面）。
 *
 * 成熟的知识系统"不是有页面，而是有运行面板"：模型进来的**第一个导航点**是 index.md。
 * 在约 100 个来源、几百页的规模下，一个内容目录就足够好用。
 *
 * 生成四个文件到 memory-root：
 * - index.md    内容目录（topic × 卡片数 × 最近更新 × 一句话摘要）
 * - overview.md 当前认知快照（当前结论 / 已知矛盾 / 开放问题）
 * - log.md      时间线（当日 ingest / lint / synthesis / review 事件）
 * - review_q.md 人工判断入口（AI 可读的待裁决清单）
 *
 * 红线：这四个文件是系统元数据，必须排除在 file-watcher 采集之外（见 CONTROL_PLANE_FILES）。
 */
export type ControlPlaneInput = {
  memories: MemoryRecord[];
  lintIssues?: LintIssue[];
  contradictions?: ContradictionItem[];
  synthesis?: SynthesisReport | null;
};

/** 粗略 token 估算：CJK 约 1 字符/token，其余按 4 字符/token（保守估计，保证不超预算） */
export function estimateTokens(text: string): number {
  const cjk = (text.match(/[\u4e00-\u9fff\u3040-\u30ff]/g) ?? []).length;
  const other = text.length - cjk;
  return Math.ceil(cjk + other / 4);
}

export class ControlPlaneService {
  /** 生成全部控制面文件，返回写入的文件名列表 */
  async writeAll(input: ControlPlaneInput): Promise<string[]> {
    const written: string[] = [];
    const files: Array<[string, string]> = [
      ["index.md", this.buildIndex(input.memories)],
      ["overview.md", this.buildOverview(input)],
      ["log.md", this.buildLog(input)],
      ["review_q.md", this.buildReviewQueue()],
    ];

    for (const [name, content] of files) {
      try {
        writeFileSync(join(getMemoryRoot(), name), content, "utf-8");
        written.push(name);
      } catch (e) {
        logger.nightly.error(`控制面文件写入失败: ${name}`, { error: (e as Error).message });
      }
    }
    return written;
  }

  /**
   * index.md：内容目录。按热度（卡片数 × 最近更新）排序，
   * 每个 topic 给出卡片数、最近更新时间与代表性摘要。
   */
  buildIndex(memories: MemoryRecord[]): string {
    const byTopic = new Map<string, MemoryRecord[]>();
    for (const memory of memories) {
      const list = byTopic.get(memory.topic) ?? [];
      list.push(memory);
      byTopic.set(memory.topic, list);
    }

    const topics = [...byTopic.entries()]
      .map(([topic, list]) => {
        const sorted = [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        return { topic, list: sorted, latest: sorted[0].updatedAt };
      })
      .sort((a, b) => b.list.length - a.list.length || b.latest.localeCompare(a.latest));

    const lines = [
      "# 知识库索引",
      "",
      `> 自动生成于 ${new Date().toISOString()}，共 ${memories.length} 条记忆、${topics.length} 个话题。`,
      "> 这是模型的第一个导航点：先读本页定位话题，再读具体记忆文件。",
      "",
    ];

    for (const { topic, list, latest } of topics) {
      const representative = list.find((m) => m.summaryZh || m.summary);
      const summary = representative?.summaryZh || representative?.summary || "（暂无摘要）";
      lines.push(`## ${topic}`);
      lines.push(`- 卡片数：${list.length}`);
      lines.push(`- 最近更新：${latest}`);
      lines.push(`- 摘要：${summary.slice(0, 80)}`);
      lines.push("");
    }

    return lines.join("\n");
  }

  /** overview.md：各话题的认知快照——当前结论、已知矛盾、开放问题 */
  buildOverview(input: ControlPlaneInput): string {
    const { memories, contradictions = [], lintIssues = [], synthesis } = input;
    const active = memories.filter((m) => (m.status ?? "active") !== "superseded");

    const byTopic = new Map<string, MemoryRecord[]>();
    for (const memory of active) {
      byTopic.set(memory.topic, [...(byTopic.get(memory.topic) ?? []), memory]);
    }

    const lines = [
      "# 认知总览",
      "",
      `> 自动生成于 ${new Date().toISOString()}。共 ${active.length} 条有效记忆。`,
      "",
      "## 当前结论",
      "",
    ];

    for (const [topic, list] of byTopic) {
      const conclusion = list.find((m) => m.kind === "synthesis") ?? list[0];
      lines.push(`### ${topic}`);
      lines.push(
        `- ${(conclusion?.summaryZh || conclusion?.summary || "（暂无结论）").slice(0, 120)}`,
      );
      if (conclusion?.kind === "synthesis") {
        lines.push(`- 来源卡片：${(conclusion.sources ?? []).length} 条`);
      }
      lines.push("");
    }

    lines.push("## 已知矛盾", "");
    if (contradictions.length === 0) {
      lines.push("_未发现矛盾_", "");
    } else {
      for (const c of contradictions) {
        lines.push(
          `- [${c.severity}] 《${c.memoryA.title}》 ↔ 《${c.memoryB.title}》：${c.description}`,
        );
      }
      lines.push("");
    }

    lines.push("## 开放问题", "");
    const openIssues = lintIssues.filter((i) => i.type !== "duplicate-hash");
    if (openIssues.length === 0 && !synthesis?.failed.length) {
      lines.push("_暂无_", "");
    } else {
      for (const issue of openIssues.slice(0, 20)) {
        lines.push(`- ${describeLintIssue(issue)}`);
      }
      for (const failed of synthesis?.failed ?? []) {
        lines.push(`- 话题「${failed.topic}」编译验证未通过，等待人工裁决`);
      }
      lines.push("");
    }

    return lines.join("\n");
  }

  /** log.md：当日事件时间线 */
  buildLog(input: ControlPlaneInput): string {
    const { memories, lintIssues = [], synthesis } = input;
    const today = new Date().toISOString().split("T")[0];
    const todayMemories = memories.filter(
      (m) => m.updatedAt?.startsWith(today) || m.createdAt?.startsWith(today),
    );

    const lines = [
      "# 运行日志",
      "",
      `> 自动生成于 ${new Date().toISOString()}`,
      "",
      `## ${today}`,
      "",
      `- 新增/更新记忆：${todayMemories.length} 条`,
      `- 结构化 Lint：${lintIssues.length} 个问题`,
      `- 知识编译：产出 ${synthesis?.created.length ?? 0} 张综合卡，${synthesis?.failed.length ?? 0} 个话题待人工`,
      "",
    ];

    for (const memory of todayMemories.slice(0, 30)) {
      lines.push(`- 《${memory.titleZh || memory.title}》（${memory.topic}）`);
    }
    lines.push("");
    return lines.join("\n");
  }

  /**
   * review_q.md：人工判断入口。
   * 汇总待裁决的 review 事件与 pending 冲突，让"刹车"在文件层也可见。
   */
  buildReviewQueue(): string {
    const db = getDatabase();
    const pendingEvents = db
      .prepare(
        `SELECT eventId, memoryId, sourceType, createdAt FROM pending_events
         WHERE status = 'review' ORDER BY createdAt ASC LIMIT 50`,
      )
      .all() as Array<{ eventId: string; memoryId: string; sourceType: string; createdAt: string }>;

    const conflicts = db
      .prepare(
        `SELECT conflictId, memoryId, field, createdAt FROM conflict_records
         WHERE status = 'pending' ORDER BY createdAt ASC LIMIT 50`,
      )
      .all() as Array<{ conflictId: string; memoryId: string; field: string; createdAt: string }>;

    const lines = [
      "# 待人工裁决队列",
      "",
      `> 自动生成于 ${new Date().toISOString()}`,
      "",
      `## 待验证记忆（${pendingEvents.length}）`,
      "",
    ];

    if (pendingEvents.length === 0) {
      lines.push("_暂无_", "");
    } else {
      for (const event of pendingEvents) {
        lines.push(
          `- \`${event.eventId}\` 记忆 \`${event.memoryId}\`（来源 ${event.sourceType}，${event.createdAt}）`,
        );
      }
      lines.push("");
    }

    lines.push(`## 待解决冲突（${conflicts.length}）`, "");
    if (conflicts.length === 0) {
      lines.push("_暂无_", "");
    } else {
      for (const conflict of conflicts) {
        lines.push(
          `- \`${conflict.conflictId}\` 记忆 \`${conflict.memoryId}\` 字段 \`${conflict.field}\`（${conflict.createdAt}）`,
        );
      }
      lines.push("");
    }

    return lines.join("\n");
  }

  /**
   * 读取截断版 index 供 chat system prompt 头部注入。
   * 硬预算：超限时按话题热度保留前若干行，绝不突破 CONTROL_PLANE_TOKEN_BUDGET。
   */
  readIndexBrief(budget: number = CONTROL_PLANE_TOKEN_BUDGET): string {
    const indexPath = join(getMemoryRoot(), "index.md");
    if (!existsSync(indexPath)) return "";

    let content: string;
    try {
      content = readFileSync(indexPath, "utf-8");
    } catch {
      return "";
    }
    if (estimateTokens(content) <= budget) return content;

    const lines = content.split("\n");
    const kept: string[] = [];
    let used = 0;
    for (const line of lines) {
      const cost = estimateTokens(line);
      if (used + cost > budget) break;
      kept.push(line);
      used += cost;
    }
    return kept.length > 0 ? `${kept.join("\n")}\n\n（索引已按 token 预算截断）` : "";
  }

  /** 控制面文件名清单（供 file-watcher 排除与测试断言） */
  static get fileNames(): string[] {
    return [...CONTROL_PLANE_FILES];
  }
}

function describeLintIssue(issue: LintIssue): string {
  switch (issue.type) {
    case "dead-link":
      return `死链：\`${issue.from}\` 指向不存在的记忆 \`${issue.to}\``;
    case "orphan":
      return `孤儿页：\`${issue.memoryId}\` 没有任何关联记忆`;
    case "incomplete-card":
      return `残缺卡：\`${issue.memoryId}\` 缺少 ${issue.missing.join("、")}`;
    case "duplicate-hash":
      return `重复来源：${issue.memoryIds.map((id) => `\`${id}\``).join("、")}`;
  }
}
