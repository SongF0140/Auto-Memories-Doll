import { NextRequest, NextResponse } from "next/server";
import { VectorRetriever } from "../../../../lib/vector/retriever";
import { MemoryService } from "../../../../server/services/memory-service";
import { apiResponse, apiError } from "../../../../lib/api-response";
import { ErrorCode } from "../../../../lib/api-errors";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q");
  const limit = Math.min(50, Math.max(1, parseInt(searchParams.get("limit") || "10")));

  if (!query) {
    return NextResponse.json(apiError(ErrorCode.VALIDATION_FAILED, "query parameter 'q' is required"), { status: 400 });
  }

  const retriever = new VectorRetriever();
  const memoryService = new MemoryService();

  try {
    // 向量检索 → 获取候选 memoryId 列表
    const results = await retriever.search(query, limit);

    // 仅按 ID 逐个加载命中的记忆，不再全量 listMemories
    const formattedResults = results
      .map(({ memoryId, similarity }) => {
        const mem = memoryService.getMemory(memoryId);
        return mem ? { ...mem, similarity } : null;
      })
      .filter((m): m is NonNullable<typeof m> => m !== null);

    return NextResponse.json(apiResponse({
      results: formattedResults,
      total: formattedResults.length,
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    console.error("[Memory/Search] 搜索失败:", message);
    return NextResponse.json(apiError(ErrorCode.MEMORY_VECTOR_FAILED, `搜索失败: ${message}`), { status: 500 });
  } finally {
    retriever.close();
    memoryService.close();
  }
}
