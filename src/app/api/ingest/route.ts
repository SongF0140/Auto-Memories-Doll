import { NextRequest, NextResponse } from "next/server";
import { InputParser } from "../../../features/ingest/parser";
import { InputNormalizer } from "../../../features/ingest/normalizer";
import { IngestAdapter } from "../../../features/ingest/adapter";
import { MemoryService } from "../../../server/services/memory-service";
import { ingestRequestSchema } from "../../../lib/validation";
import { logger } from "../../../lib/logger";

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体格式无效，需要 JSON" }, { status: 400 });
  }

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

    const results = memoryRecords.map((record) =>
      memoryService.stageCreateMemory(
        record.source,
        record.sourceType,
        record.title,
        record.content,
        record.summary,
        record.tags,
        record.topic,
      ),
    );

    return NextResponse.json({ success: true, memories: results });
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    logger.api.error("[Ingest] 导入失败:", { message });
    return NextResponse.json({ error: `导入失败: ${message}` }, { status: 500 });
  } finally {
    memoryService.close();
  }
}
