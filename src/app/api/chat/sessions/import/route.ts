import { NextRequest, NextResponse } from "next/server";
import { apiError, apiResponse } from "../../../../../lib/api-response";
import { ErrorCode } from "../../../../../lib/api-errors";
import { chatSessionImportSchema } from "../../../../../lib/validation";
import { ChatSessionService } from "../../../../../server/services/chat-session-service";

/** POST /api/chat/sessions/import — 幂等迁移旧 localStorage 会话。 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(apiError(ErrorCode.INVALID_JSON, "请求体必须是合法的 JSON"), {
      status: 400,
    });
  }

  const parsed = chatSessionImportSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      apiError(ErrorCode.VALIDATION_FAILED, parsed.error.issues[0].message),
      { status: 400 },
    );
  }

  try {
    const service = new ChatSessionService();
    let imported = 0;
    for (const session of parsed.data.sessions) {
      if (service.importSnapshot(session)) imported += 1;
    }
    return NextResponse.json(
      apiResponse({ imported, skipped: parsed.data.sessions.length - imported }),
    );
  } catch (error) {
    return NextResponse.json(apiError(ErrorCode.INTERNAL_ERROR, (error as Error).message), {
      status: 500,
    });
  }
}
