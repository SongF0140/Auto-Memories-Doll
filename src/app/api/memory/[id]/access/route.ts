import { NextRequest, NextResponse } from "next/server";
import { MemoryService } from "../../../../../server/services/memory-service";

/**
 * POST /api/memory/[id]/access
 * 记录用户访问：递增 accessCount + 刷新 accessedAt
 *
 * 按 AGENTS.md 4.8 "搜索回写由前端搜索命中事件触发"——
 * 前端在用户点击/展开记忆卡片时调用此端点，
 * 而不是在自动召回时递增（避免 heatScore 被召回污染）。
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const service = new MemoryService();

  try {
    const existing = service.getMemory(params.id);
    if (!existing) {
      return NextResponse.json({ error: "Memory not found" }, { status: 404 });
    }

    service.incrementAccess(params.id);
    const updated = service.getMemory(params.id)!;

    return NextResponse.json({
      success: true,
      accessCount: updated.accessCount,
      accessedAt: updated.accessedAt,
    });
  } finally {
    service.close();
  }
}
