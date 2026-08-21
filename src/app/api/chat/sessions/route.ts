import { NextResponse } from "next/server";
import { apiError, apiResponse } from "../../../../lib/api-response";
import { ErrorCode } from "../../../../lib/api-errors";
import { ChatSessionService } from "../../../../server/services/chat-session-service";


export const dynamic = "force-dynamic";

/** GET /api/chat/sessions — 返回轻量会话摘要，不携带完整消息。 */
export async function GET() {
  try {
    const sessions = new ChatSessionService().listSessions();
    return NextResponse.json(apiResponse({ sessions }));
  } catch (error) {
    return NextResponse.json(apiError(ErrorCode.INTERNAL_ERROR, (error as Error).message), {
      status: 500,
    });
  }
}
