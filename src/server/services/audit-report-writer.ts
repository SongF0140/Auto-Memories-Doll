import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { getArchivePath } from "../../lib/storage/path-resolver";
import { getCurrentTime } from "../../lib/utils/date";
import { logger } from "../../lib/logger";

export type MarkdownReportSource = {
  generateMarkdownReport(): Promise<string>;
};

export class AuditReportWriter {
  constructor(private reporter: MarkdownReportSource) {}

  async write(): Promise<string> {
    const markdown = await this.reporter.generateMarkdownReport();
    const auditsDir = join(getArchivePath(), "audits");
    mkdirSync(auditsDir, { recursive: true });

    const timestamp = getCurrentTime().replace(/[:.]/g, "-").substring(0, 19);
    const filePath = join(auditsDir, `audit-${timestamp}.md`);
    writeFileSync(filePath, markdown, "utf-8");

    logger.audit.info("Markdown audit report written", { path: filePath });
    return filePath;
  }
}
