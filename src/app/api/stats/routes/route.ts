import { NextResponse } from "next/server";
import { RouteStatsService } from "../../../../lib/vector/route-stats";
import { ErrorCode } from "../../../../lib/api-errors";
import { apiError } from "../../../../lib/api-response";
import { logger } from "../../../../lib/logger";

/**
 * GET /api/stats/routes — 检索路由分布（健康度面板·路由分布项）。
 * @query days 统计窗口天数，默认 7
 */
export async function GET(request: Request) {
  const daysParam = new URL(request.url).searchParams.get("days");
  const days = Math.min(90, Math.max(1, Number(daysParam) || 7));

  try {
    const stats = new RouteStatsService().getStats(days);
    return NextResponse.json({
      since: stats.since,
      days,
      total: stats.total,
      totals: stats.totals,
      distribution: Object.fromEntries(
        Object.entries(stats.totals).map(([route, count]) => [
          route,
          stats.total > 0 ? Math.round((count / stats.total) * 1000) / 10 : 0,
        ]),
      ),
    });
  } catch (error) {
    logger.api.error("GET /api/stats/routes 处理失败", {
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(apiError(ErrorCode.INTERNAL_ERROR, "路由统计读取失败"), {
      status: 500,
    });
  }
}
