import { NextResponse } from "next/server";
import { ConfigService } from "../../../../../server/services/config-service";
import { getActiveSources } from "../../../../../server/watchers/tool-dir-watcher";
import { getFileWatcherStatus } from "../../../../../server/watchers/file-watcher";
import { MemoryService } from "../../../../../server/services/memory-service";

/**
 * GET /api/config/tool-sources/status
 * 监听运行状态：文件监听器、工具监听器（配置数/活跃数）+ 各状态事件计数。
 */
export async function GET() {
  const activeSources = getActiveSources();

  const configService = new ConfigService();
  let enabledCount: number;
  try {
    enabledCount = configService.listEnabledToolSources().length;
  } finally {
    configService.close();
  }

  const memoryService = new MemoryService();
  let events: { pending: number; review: number; failed: number };
  try {
    events = {
      pending: memoryService.getEventsByStatus("pending").length,
      review: memoryService.getEventsByStatus("review").length,
      failed: memoryService.getEventsByStatus("failed").length,
    };
  } finally {
    memoryService.close();
  }

  return NextResponse.json({
    fileWatcher: getFileWatcherStatus(),
    toolWatcher: {
      configured: enabledCount,
      running: activeSources.length,
      sources: activeSources,
    },
    events,
  });
}
