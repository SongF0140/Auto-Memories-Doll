import { InputEvent } from "../../types/event";
import { MemoryRecord } from "../../types/memory";
import { MemoryExtractor } from "../memory/extractor";

export type IngestSource = "chat" | "ingest" | "manual" | "mcp" | "skill";

export interface IngestResult {
  success: boolean;
  memoryId?: string;
  error?: string;
}

export class IngestAdapter {
  private extractor: MemoryExtractor;

  constructor() {
    this.extractor = new MemoryExtractor();
  }

  adapt(event: InputEvent): MemoryRecord {
    return this.extractor.extractFromText(
      event.source,
      event.source as MemoryRecord["sourceType"],
      event.content
    );
  }

  adaptBatch(events: InputEvent[]): MemoryRecord[] {
    return events.map(event => this.adapt(event));
  }
}