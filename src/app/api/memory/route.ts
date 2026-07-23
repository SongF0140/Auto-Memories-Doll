import { NextRequest, NextResponse } from "next/server";
import { MemoryService } from "../../../server/services/memory-service";
import { MemoryExtractor } from "../../../features/memory/extractor";

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

    // 标签筛选
    if (tag) {
      result = result.filter(m => m.tags.includes(tag));
    }

    // 排序
    const orderMul = sortOrder === "asc" ? 1 : -1;
    result.sort((a, b) => {
      const aVal = (a as any)[sortBy] ?? "";
      const bVal = (b as any)[sortBy] ?? "";
      if (typeof aVal === "number" && typeof bVal === "number") {
        return (aVal - bVal) * orderMul;
      }
      return String(aVal).localeCompare(String(bVal)) * orderMul;
    });

    // 分页
    const total = result.length;
    const start = (page - 1) * pageSize;
    const paged = result.slice(start, start + pageSize);

    return NextResponse.json({ items: paged, total, page, pageSize });
  } finally {
    service.close();
  }
}

export async function POST(request: NextRequest) {
  const { source, sourceType, content, title, tags } = await request.json();
  
  if (!content) {
    return NextResponse.json({ error: "content is required" }, { status: 400 });
  }

  const service = new MemoryService();
  const extractor = new MemoryExtractor();
  
  try {
    const memoryRecord = extractor.extractFromStructuredData(
      source || "manual",
      (sourceType || "manual") as any,
      { title: title || "", content, tags }
    );
    
    const memoryId = await service.createMemory(
      memoryRecord.source,
      memoryRecord.sourceType,
      memoryRecord.title,
      memoryRecord.content,
      memoryRecord.summary,
      memoryRecord.tags
    );
    return NextResponse.json({ ...memoryRecord, id: memoryId });
  } finally {
    service.close();
  }
}