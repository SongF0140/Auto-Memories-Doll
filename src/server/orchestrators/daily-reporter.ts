import { promises as fs } from "fs";
import { join } from "path";
import { getArchivePath } from "../../lib/storage/path-resolver";
import { NightlyReport } from "./nightly-orchestrator";
import { logger } from "../../lib/logger";

/**
 * 日报生成器。
 *
 * 将 NightlyOrchestrator 的运行结果格式化为 Markdown 日报，
 * 写入 archive/daily/YYYY-MM-DD.md，用户第二天可查阅。
 */
export class DailyReporter {
  async write(report: NightlyReport): Promise<string> {
    const dailyDir = join(getArchivePath(), "daily");
    await fs.mkdir(dailyDir, { recursive: true });

    const filePath = join(dailyDir, `${report.date}.md`);
    const markdown = this.buildMarkdown(report);

    await fs.writeFile(filePath, markdown, "utf-8");
    logger.nightly.info("日报已写入", { path: filePath });
    return filePath;
  }

  private buildMarkdown(r: NightlyReport): string {
    const sections: string[] = [
      `# 深夜督查日报 — ${r.date}`,
      "",
      `> 开始时间: ${r.startedAt}`,
      `> 完成时间: ${r.completedAt}`,
      `> 整体状态: ${r.allSucceeded ? "全部成功" : "部分失败"}`,
      "",
      `## 概览`,
      "",
      `当日新增/修改记忆: **${r.todaysMemoryCount}** 条`,
      "",
    ];

    // 矛盾检测
    sections.push("## 知识矛盾检测");
    if (r.contradiction && r.contradiction.contradictions.length > 0) {
      sections.push(
        `- 比较了 ${r.contradiction.totalCompared} 对记忆`,
        `- 发现 **${r.contradiction.contradictions.length}** 处潜在矛盾`,
        "",
      );
      for (const c of r.contradiction.contradictions) {
        const severity = c.severity === "high" ? "高危" : c.severity === "medium" ? "中等" : "低危";
        sections.push(
          `### ${severity} | "${c.memoryA.title}" vs "${c.memoryB.title}"`,
          "",
          `- **新记忆**: ${c.memoryA.summary}`,
          `- **旧记忆**: ${c.memoryB.summary}`,
          `- **矛盾**: ${c.description}`,
          `- **建议**: ${c.suggestion}`,
          "",
        );
      }
    } else {
      sections.push("- 未发现知识矛盾", "");
    }

    // wikilink 补充
    sections.push("## wikilink 关联补充");
    if (r.links && r.links.suggestions.length > 0) {
      sections.push(
        `- 建议 **${r.links.suggestions.length}** 处链接`,
        `- 成功添加 **${r.links.addedCount}** 处`,
        `- 失败 **${r.links.failedCount}** 处`,
        "",
      );
      for (const s of r.links.suggestions) {
        sections.push(`- "${s.from.title}" → "${s.to.title}": ${s.reason}`);
      }
    } else {
      sections.push("- 未发现遗漏的链接", "");
    }

    // 路由优化
    sections.push("## 路由表优化");
    if (r.routing && r.routing.suggestions.length > 0) {
      sections.push(
        `- 建议 **${r.routing.suggestions.length}** 项调整`,
        `- 已应用 **${r.routing.appliedCount}** 项`,
        "",
      );
      for (const s of r.routing.suggestions) {
        sections.push(`- \`${s.taskCategory}\`: ${s.currentModel} → **${s.suggestedModel}** — ${s.reason}`);
      }
    } else {
      sections.push("- 当前路由表无需调整", "");
    }

    // 错误
    if (r.errors.length > 0) {
      sections.push("## 错误", "");
      for (const e of r.errors) {
        sections.push(`- ${e}`);
      }
    }

    return sections.join("\n") + "\n";
  }
}
