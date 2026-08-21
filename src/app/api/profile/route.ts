import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ProfileUpdater } from "../../../server/services/profile-updater";
import { ModelAdapter } from "../../../lib/ai/model-adapter";


const analyzeRequestSchema = z.object({
  memoryIds: z.array(z.string().min(1).max(128)).max(50).optional(),
});

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
export async function POST(request: NextRequest) {
  let body: unknown = {};
  if (request.headers.get("content-type")?.includes("application/json")) {
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "请求体必须是合法的 JSON" }, { status: 400 });
    }
  }

  const parsed = analyzeRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

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
