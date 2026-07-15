import { NextRequest, NextResponse } from "next/server";
import { MemoryService } from "../../../server/services/memory-service";
import { MemoryExtractor } from "../../../features/memory/extractor";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get("page") || "1");
  const pageSize = parseInt(searchParams.get("pageSize") || "20");
  const tag = searchParams.get("tag");
  const sortBy = searchParams.get("sortBy") || "updatedAt";
  const sortOrder = searchParams.get("sortOrder") || "desc";

  const service = new MemoryService();
  
  try {
    const result = service.listMemories();
    return NextResponse.json(result);
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