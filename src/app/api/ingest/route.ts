import { NextRequest, NextResponse } from "next/server";
import { InputParser } from "../../../features/ingest/parser";
import { InputNormalizer } from "../../../features/ingest/normalizer";
import { IngestAdapter } from "../../../features/ingest/adapter";
import { MemoryService } from "../../../server/services/memory-service";
import { ingestRequestSchema } from "../../../lib/validation";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const parsed = ingestRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { content, format } = parsed.data;

  const parser = new InputParser();
  const normalizer = new InputNormalizer();
  const adapter = new IngestAdapter();
  const memoryService = new MemoryService();

  try {
    let events;
    if (format === "json") {
      events = parser.parseJson(content);
    } else {
      events = [parser.parseText(content)];
    }

    const normalizedEvents = normalizer.normalize(events);
    const memoryRecords = adapter.adaptBatch(normalizedEvents);

    const results = await Promise.all(memoryRecords.map(record =>
      memoryService.createMemory(
        record.source,
        record.sourceType,
        record.title,
        record.content,
        record.summary,
        record.tags
      )
    ));

    return NextResponse.json({ success: true, memories: results });
  } finally {
    memoryService.close();
  }
}