import { NextRequest, NextResponse } from "next/server";
import { Orchestrator } from "../../../../server/services/orchestrator";
import { scanMemoryRoot } from "../../../../server/watchers/file-watcher";
import { scanToolSources } from "../../../../server/watchers/tool-dir-watcher";
import { ErrorCode } from "../../../../lib/api-errors";
import { apiError } from "../../../../lib/api-response";
import { logger } from "../../../../lib/logger";

/**
 * POST /api/listen/rebuild
 *
 * 重建采集卡片（审计页「重建」按钮）：
 * 1. 删除所有 sourceType=ingest 的文件采集记忆（SQLite + 向量 + 派生 Markdown）
 *    ——旧链路（原文直存）留下的英文/乱码卡 content 与原文一致，重扫会被内容跳过，
 *    向量去重也会拒掉重采事件，必须先删才能经新抽取链路重生成中文分卡。
 * 2. 全量重扫记忆库与工具监听源，重新入队；队列消费时按话题拆分并全文重写为中文。
 *
 * 对话/手动/MCP 创建的记忆不受影响。
 */
export async function POST(_request: NextRequest) {
  try {
    // 动态 import 不可用（Orchestrator 无启动副作用），直接实例化，与其它路由一致
    const orchestrator = new Orchestrator();
    const deleted = await orchestrator.rebuildCollectedMemories();
    const scannedFiles = await scanMemoryRoot();
    const scannedSources = await scanToolSources();
    const scanned = scannedFiles + scannedSources;
    return NextResponse.json({
      success: true,
      deleted,
      scanned,
      message: `已删除 ${deleted} 张旧采集卡片，重扫 ${scanned} 个文件已重新入队。队列将陆续按话题拆分并生成中文卡片（每条来源需 1-2 分钟，请稍后刷新记忆页查看）`,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    logger.api.error("POST /api/listen/rebuild 处理失败", {
      message: detail,
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json(apiError(ErrorCode.INTERNAL_ERROR, "重建失败"), { status: 500 });
  }
}
