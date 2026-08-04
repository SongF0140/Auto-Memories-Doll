import { NextRequest, NextResponse } from "next/server";
import { ProfileUpdater } from "../../../server/services/profile-updater";
import { ModelAdapter } from "../../../lib/ai/model-adapter";

/**
 * GET /api/profile
 * 返回当前用户画像内容 + 变更历史。
 */
export async function GET() {
  const updater = ProfileUpdater.getInstance();
  const content = updater.getProfileContent();
  const changelog = updater.getChangelog(20);
  return NextResponse.json({
    content,
    changelog,
    degradedMode: ModelAdapter.isDegradedMode,
  });
}

/**
 * POST /api/profile/analyze
 * 手动触发画像分析（从队列中取出待分析的对话）。
 */
export async function POST(_request: NextRequest) {
  const updater = ProfileUpdater.getInstance();
  try {
    await updater.runAnalysis();
    const content = updater.getProfileContent();
    const changelog = updater.getChangelog(20);
    return NextResponse.json({
      success: true,
      content,
      changelog,
    });
  } catch (error) {
    return NextResponse.json(
      { error: `分析失败: ${(error as Error).message}` },
      { status: 500 },
    );
  }
}
