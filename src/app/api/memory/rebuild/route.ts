import { NextResponse } from "next/server";
import { Orchestrator } from "../../../../server/services/orchestrator";
import { ErrorCode } from "../../../../lib/api-errors";
import { apiError } from "../../../../lib/api-response";
import { logger } from "../../../../lib/logger";

export async function POST() {
  const orchestrator = new Orchestrator();
  try {
    const queued = await orchestrator.enqueueFullMemoryRebuild();
    return NextResponse.json({
      success: true,
      queued,
      message: `已扫描现有记忆并加入 ${queued} 个重建任务。模型不可用时任务会保留在队列，恢复后自动继续。`,
    });
  } catch (error) {
    logger.api.error("POST /api/memory/rebuild 处理失败", {
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(apiError(ErrorCode.INTERNAL_ERROR, "全量重建入队失败"), {
      status: 500,
    });
  } finally {
    orchestrator.close();
  }
}
