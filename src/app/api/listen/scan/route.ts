import { NextRequest, NextResponse } from "next/server";
import { scanMemoryRoot } from "../../../../server/watchers/file-watcher";
import { scanToolSources } from "../../../../server/watchers/tool-dir-watcher";
import { ErrorCode } from "../../../../lib/api-errors";
import { apiError } from "../../../../lib/api-response";
import { logger } from "../../../../lib/logger";

/**
 * POST /api/listen/scan
 *
 * 手动触发全量重扫：
 * 1. 记忆库目录下所有 Markdown（file-watcher 管辖）
 * 2. 已配置的工具会话监听源目录（tool-dir-watcher 管辖）
 *
 * 已入库且内容未变更的文件会在采集层被哈希跳过，不产生重复 LLM 成本。
 */
export async function POST(_request: NextRequest) {
  try {
    // 动态 import：避免路由 bundle 在模块加载期触发 watcher 模块的启动副作用
    const scannedFiles = await scanMemoryRoot();
    const scannedSources = await scanToolSources();
    return NextResponse.json({
      success: true,
      scanned: scannedFiles + scannedSources,
      detail: { markdownFiles: scannedFiles, toolSourceFiles: scannedSources },
      message: `扫描完成：${scannedFiles} 个 Markdown + ${scannedSources} 个工具会话文件已检查（未变更的自动跳过，不产生 LLM 成本）`,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    logger.api.error("POST /api/listen/scan 处理失败", {
      message: detail,
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json(apiError(ErrorCode.INTERNAL_ERROR, "扫描失败"), { status: 500 });
  }
}
