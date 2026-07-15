import { ChatMessage } from "../../types/api";
import { MemoryRecord } from "../../types/memory";
import { buildMemoryRecord } from "../../lib/memory/builder";
import { formatSummary } from "../../server/pipelines/formatter";
import { extractTags } from "../../server/pipelines/json-pipeline";

export interface MemoryExtractionResult {
  title: string;
  content: string;
  summary: string;
  tags: string[];
}

export class ChatExtractor {
  extractMemoryFromMessages(messages: ChatMessage[]): MemoryExtractionResult {
    const relevantMessages = messages.slice(-5);
    const content = relevantMessages.map(m => `${m.role}: ${m.content}`).join("\n");
    
    const title = this.extractTitle(content);
    const summary = formatSummary(content, 150);
    const tags = extractTags(content);

    return {
      title,
      content,
      summary,
      tags,
    };
  }

  buildMemoryRecord(
    source: string,
    sourceType: "chat" | "ingest" | "manual" | "mcp" | "skill",
    messages: ChatMessage[]
  ): MemoryRecord {
    const extraction = this.extractMemoryFromMessages(messages);
    
    return buildMemoryRecord(
      source,
      sourceType,
      extraction.title,
      extraction.content,
      extraction.summary,
      extraction.tags
    );
  }

  private extractTitle(content: string): string {
    const lines = content.split("\n").filter(l => l.trim());
    
    for (const line of lines) {
      if (line.length > 5 && line.length < 50) {
        const cleanLine = line.replace(/^(user|assistant):\s*/i, "").trim();
        if (cleanLine.length > 5) {
          return cleanLine;
        }
      }
    }
    
    return content.substring(0, 30).replace(/\n/g, " ") + "...";
  }
}