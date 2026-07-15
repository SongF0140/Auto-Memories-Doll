import { MemoryRecord } from "../../types/memory";
import { buildMemoryRecord } from "../../lib/memory/builder";
import { formatSummary } from "../../server/pipelines/formatter";
import { extractTags } from "../../server/pipelines/json-pipeline";

export interface MemoryExtractionOptions {
  maxSummaryLength?: number;
  maxTagCount?: number;
}

export class MemoryExtractor {
  extractFromText(
    source: string,
    sourceType: "chat" | "ingest" | "manual" | "mcp" | "skill",
    text: string,
    options: MemoryExtractionOptions = {}
  ): MemoryRecord {
    const title = this.extractTitle(text);
    const summary = formatSummary(text, options.maxSummaryLength || 200);
    const tags = extractTags(text).slice(0, options.maxTagCount || 5);

    return buildMemoryRecord(source, sourceType, title, text, summary, tags);
  }

  extractFromStructuredData(
    source: string,
    sourceType: "chat" | "ingest" | "manual" | "mcp" | "skill",
    data: { title: string; content: string; tags?: string[]; summary?: string }
  ): MemoryRecord {
    const title = data.title || this.extractTitle(data.content);
    const summary = data.summary || formatSummary(data.content);
    const tags = data.tags || extractTags(data.content).slice(0, 5);

    return buildMemoryRecord(source, sourceType, title, data.content, summary, tags);
  }

  private extractTitle(text: string): string {
    const lines = text.split("\n").filter(l => l.trim());
    
    for (const line of lines) {
      if (line.startsWith("# ")) {
        return line.substring(2).trim();
      }
    }
    
    for (const line of lines) {
      if (line.length > 5 && line.length < 80) {
        return line.trim();
      }
    }
    
    return text.substring(0, 50).replace(/\n/g, " ").trim() + "...";
  }
}