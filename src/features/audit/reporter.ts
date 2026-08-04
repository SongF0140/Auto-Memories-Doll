import { MemoryService } from "../../server/services/memory-service";
import { AuditService } from "../../server/services/audit-service";
import { ConflictRecord, MemoryRecord } from "../../types/memory";
import { getCurrentTime } from "../../lib/utils/date";
import { logger } from "../../lib/logger";

export interface AuditReport {
  totalMemories: number;
  pendingEvents: number;
  conflicts: number;
}

/**
 * 审计报告生成器 —— 既输出结构化统计，也生成人类/LLM 可读的 Markdown 审计文本。
 *
 * 对应《架构检查文档.md》4.7 "markdown 流式转码 + LLM" 的可读审计要求：
 * 任何一次系统决策都应能追溯到一份可读文本，而非仅 SQLite 行。
 */
export class AuditReporter {
  private memoryService: MemoryService;
  private auditService: AuditService;

  constructor() {
    this.memoryService = new MemoryService();
    this.auditService = new AuditService();
  }

  async generateReport(): Promise<AuditReport> {
    const memories = this.memoryService.listMemories();
    const conflicts = this.auditService.listConflicts("pending");

    return {
      totalMemories: memories.length,
      pendingEvents: 0,
      conflicts: conflicts.length,
    };
  }

  /**
   * 生成可读 Markdown 审计文本：聚合记忆统计、按来源/话题分布、待处理冲突清单。
   * 供 Orchestrator 在每轮队列处理完成后写入 archive/audits/audit-{timestamp}.md。
   */
  async generateMarkdownReport(): Promise<string> {
    const memories = this.memoryService.listMemories();
    const conflicts = this.auditService.listConflicts("pending");
    const timestamp = getCurrentTime();

    const bySourceType = this.groupBy(memories, (m) => m.sourceType);
    const byTopic = this.groupBy(memories, (m) => m.topic || "uncategorized");

    const lines: string[] = [];
    lines.push(`# 审计报告`);
    lines.push(``);
    lines.push(`> 生成时间: ${timestamp}`);
    lines.push(`> 记忆总数: ${memories.length} ｜ 待处理冲突: ${conflicts.length}`);
    lines.push(``);

    lines.push(`## 按来源类型分布`);
    for (const [key, count] of Object.entries(bySourceType).sort((a, b) => b[1] - a[1])) {
      lines.push(`- **${key}**: ${count}`);
    }
    lines.push(``);

    lines.push(`## 按话题分布`);
    for (const [key, count] of Object.entries(byTopic).sort((a, b) => b[1] - a[1])) {
      lines.push(`- **${key}**: ${count}`);
    }
    lines.push(``);

    lines.push(`## 待处理冲突`);
    if (conflicts.length === 0) {
      lines.push(`- 无`);
    } else {
      for (const c of conflicts.slice(0, 50)) {
        lines.push(
          `- [\`${c.conflictId.slice(0, 8)}\`] memory=\`${c.memoryId.slice(0, 8)}\` field=\`${c.field}\` 创建于 ${c.createdAt}`,
        );
      }
      if (conflicts.length > 50) {
        lines.push(`- ... 另有 ${conflicts.length - 50} 条未列出`);
      }
    }
    lines.push(``);

    lines.push(`## 最近更新记忆（前 20 条）`);
    const recent = [...memories]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 20);
    for (const m of recent) {
      const title = m.titleZh || m.title;
      lines.push(
        `- [\`${m.id.slice(0, 8)}\`] ${title} (topic=${m.topic}, heat=${m.heatScore.toFixed(3)}, tags=[${m.tags.slice(0, 3).join(", ")}])`,
      );
    }

    logger.audit.info("Markdown 审计报告已生成", { memories: memories.length, conflicts: conflicts.length });
    return lines.join("\n");
  }

  private groupBy<T>(arr: T[], keyFn: (item: T) => string): Record<string, number> {
    const result: Record<string, number> = {};
    for (const item of arr) {
      const key = keyFn(item);
      result[key] = (result[key] || 0) + 1;
    }
    return result;
  }

  close(): void {
    this.memoryService.close();
    this.auditService.close();
  }
}
