import { NextRequest, NextResponse } from "next/server";
import { VectorRetriever } from "../../../../lib/vector/retriever";
import { MemoryService } from "../../../../server/services/memory-service";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q");
  const limit = parseInt(searchParams.get("limit") || "10");

  if (!query) {
    return NextResponse.json({ error: "query parameter 'q' is required" }, { status: 400 });
  }

  const retriever = new VectorRetriever();
  const memoryService = new MemoryService();

  try {
    const results = await retriever.search(query, limit);
    const memories = memoryService.listMemories();
    const memoryMap = new Map(memories.map((m) => [m.id, m]));

    const formattedResults = results
      .map((result) => ({
        ...memoryMap.get(result.memoryId),
        similarity: result.similarity,
      }))
      .filter((m): m is typeof m => m !== undefined);

    return NextResponse.json({ results: formattedResults });
  } finally {
    retriever.close();
    memoryService.close();
  }
}
