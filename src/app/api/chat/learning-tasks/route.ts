import { NextResponse } from "next/server";
import { ConversationLearningService } from "@/server/services/conversation-learning-service";

/**
 * GET /api/chat/learning-tasks?sessionId=xxx
 * 会话知识处理任务状态摘要（第 16 块反馈链路）。
 * 脱敏：只回传状态、摘要文案与计数，不回传 result_json 正文，
 * 避免私人对话内容经聊天 UI 轮询通道泄漏。
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("sessionId")?.trim();
  if (!sessionId) {
    return NextResponse.json(
      { success: false, error: { message: "缺少 sessionId 参数" } },
      { status: 400 },
    );
  }

  try {
    const service = new ConversationLearningService();
    const tasks = service.listTasksBySession(sessionId);
    const items = tasks.map((task) => {
      const result = task.resultJson as {
        items?: unknown[];
        reconciliation?: { accepted?: number; pending?: number; duplicates?: number };
      } | null;
      const knowledgeCount = Array.isArray(result?.items) ? result.items.length : 0;
      return {
        turnId: task.turnId,
        status: task.status,
        resultSummary: task.resultSummary,
        knowledgeCount,
        reconciliation: result?.reconciliation ?? null,
      };
    });
    return NextResponse.json({ success: true, data: { tasks: items } });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: { message: `学习任务查询失败: ${(error as Error).message}` } },
      { status: 500 },
    );
  }
}
