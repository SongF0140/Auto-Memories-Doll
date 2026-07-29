import { NextRequest, NextResponse } from "next/server";
import { MemoryService } from "../../../server/services/memory-service";
import { MemoryExtractor } from "../../../features/memory/extractor";
import { memoryCreateSchema } from "../../../lib/validation";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
  const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("pageSize") || "20")));
  const tag = searchParams.get("tag");
  const sortBy = searchParams.get("sortBy") || "updatedAt";
  const sortOrder = searchParams.get("sortOrder") === "asc" ? "asc" : "desc";

  const service = new MemoryService();

  try {
    let result = service.listMemories();

    if (tag) {
      result = result.filter((m) => m.tags.includes(tag));
    }

    const orderMul = sortOrder === "asc" ? 1 : -1;
    result.sort((a, b) => {
      const aVal = (a as any)[sortBy] ?? "";
      const bVal = (b as any)[sortBy] ?? "";
      if (typeof aVal === "number" && typeof bVal === "number") {
        return (aVal - bVal) * orderMul;
      }
      return String(aVal).localeCompare(String(bVal)) * orderMul;
    });

    const total = result.length;
    const start = (page - 1) * pageSize;
    const paged = result.slice(start, start + pageSize);

    return NextResponse.json({ items: paged, total, page, pageSize });
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    console.error("[Memory] 列表查询失败:", message);
    return NextResponse.json({ error: `查询失败: ${message}` }, { status: 500 });
  } finally {
    service.close();
  }
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体格式无效" }, { status: 400 });
  }

  const parsed = memoryCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { title, content, tags, sourceType } = parsed.data;
  const source = sourceType === "manual" ? "manual" : sourceType;

  const service = new MemoryService();
  const extractor = new MemoryExtractor();

  try {
    const memoryRecord = extractor.extractFromStructuredData(source, sourceType, {
      title,
      content,
      tags,
    });
    const memoryId = await service.createMemory(
      memoryRecord.source,
      memoryRecord.sourceType,
      memoryRecord.title,
      memoryRecord.content,
      memoryRecord.summary,
      memoryRecord.tags,
      memoryRecord.topic,
      {
        titleZh: memoryRecord.titleZh,
        summaryZh: memoryRecord.summaryZh,
        tagsZh: memoryRecord.tagsZh,
        topicZh: memoryRecord.topicZh,
      },
    );
    return NextResponse.json({ ...memoryRecord, id: memoryId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    console.error("[Memory] 创建失败:", message);
    return NextResponse.json({ error: `创建失败: ${message}` }, { status: 500 });
  } finally {
    service.close();
  }
}
