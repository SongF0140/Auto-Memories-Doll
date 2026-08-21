import { NextRequest, NextResponse } from "next/server";
import { VectorRetriever } from "../../../../lib/vector/retriever";
import { MemoryService } from "../../../../server/services/memory-service";
import { apiResponse, apiError } from "../../../../lib/api-response";
import { ErrorCode } from "../../../../lib/api-errors";
import { logger } from "../../../../lib/logger";
import type { RetrievalMode } from "../../../../lib/vector/retriever";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q");
  const category = searchParams.get("category");
  const limit = Math.min(50, Math.max(1, parseInt(searchParams.get("limit") || "10")));
  // 可选相似度阈值：默认 0.3（与 VectorRetriever 默认一致），传 0 表示不过滤
  const threshold = Math.max(0, Math.min(1, parseFloat(searchParams.get("threshold") || "0.3")));

  if (!query && !category) {
    return NextResponse.json(
      apiError(ErrorCode.VALIDATION_FAILED, "query parameter 'q' or 'category' is required"),
      { status: 400 },
    );
  }

  const retriever = new VectorRetriever();
  const memoryService = new MemoryService();

  try {
    let candidateIds: string[] = [];
    let retrievalMode: RetrievalMode | null = null;

    if (query) {
      // 语义检索；Embedding 不可用时 Retriever 自动切换关键词召回。
      const search = await retriever.searchDetailed(query, limit, threshold);
      retrievalMode = search.mode;
      candidateIds = search.results.map((result) => result.memoryId);
    }

    if (category) {
      const classified = memoryService.listClassifications(category);
      const classifiedIds = classified.map((c) => c.memoryId);
      candidateIds = query
        ? candidateIds.filter((id) => classifiedIds.includes(id))
        : classifiedIds.slice(0, limit);
    }

    // 仅按 ID 逐个加载命中的记忆，不再全量 listMemories
    const formattedResults = candidateIds
      .slice(0, limit)
      .map((memoryId) => {
        const mem = memoryService.getMemory(memoryId);
        return mem ? { ...mem, ...(category ? { category } : {}) } : null;
      })
      .filter((m): m is NonNullable<typeof m> => m !== null);

    return NextResponse.json(
      apiResponse({
        results: formattedResults,
        total: formattedResults.length,
        retrievalMode,
        degradedMode: retrievalMode === "keyword",
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    logger.api.error("[Memory/Search] 搜索失败:", { message });
    return NextResponse.json(apiError(ErrorCode.MEMORY_VECTOR_FAILED, `搜索失败: ${message}`), {
      status: 500,
    });
  } finally {
    retriever.close();
    memoryService.close();
  }
}
