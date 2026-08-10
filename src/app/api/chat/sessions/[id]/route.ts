import { NextRequest, NextResponse } from "next/server";
import { apiError, apiResponse } from "../../../../../lib/api-response";
import { ErrorCode } from "../../../../../lib/api-errors";
import { chatSessionIdSchema, chatSessionWriteSchema } from "../../../../../lib/validation";
import { ChatSessionService } from "../../../../../server/services/chat-session-service";

type RouteContext = { params: { id: string } };

function parseSessionId(params: RouteContext["params"]) {
  return chatSessionIdSchema.safeParse(params.id);
}

/** GET /api/chat/sessions/:id — 恢复最后一条有效快照。 */
export async function GET(_request: NextRequest, { params }: RouteContext) {
  const id = parseSessionId(params);
  if (!id.success) {
    return NextResponse.json(apiError(ErrorCode.VALIDATION_FAILED, id.error.issues[0].message), {
      status: 400,
    });
  }

  try {
    const session = new ChatSessionService().getLatest(id.data);
    if (!session) {
      return NextResponse.json(apiError(ErrorCode.NOT_FOUND, "会话不存在"), { status: 404 });
    }
    return NextResponse.json(apiResponse({ session }));
  } catch (error) {
    return NextResponse.json(apiError(ErrorCode.INTERNAL_ERROR, (error as Error).message), {
      status: 500,
    });
  }
}

/** PUT /api/chat/sessions/:id — 追加一条会话快照。 */
export async function PUT(request: NextRequest, { params }: RouteContext) {
  const id = parseSessionId(params);
  if (!id.success) {
    return NextResponse.json(apiError(ErrorCode.VALIDATION_FAILED, id.error.issues[0].message), {
      status: 400,
    });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(apiError(ErrorCode.INVALID_JSON, "请求体必须是合法的 JSON"), {
      status: 400,
    });
  }

  const parsed = chatSessionWriteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      apiError(ErrorCode.VALIDATION_FAILED, parsed.error.issues[0].message),
      { status: 400 },
    );
  }

  try {
    const appended = new ChatSessionService().appendSnapshot({
      sessionId: id.data,
      ...parsed.data,
    });
    return NextResponse.json(apiResponse({ sessionId: id.data, appended }));
  } catch (error) {
    return NextResponse.json(apiError(ErrorCode.INTERNAL_ERROR, (error as Error).message), {
      status: 500,
    });
  }
}

/** DELETE /api/chat/sessions/:id — 追加删除标记，保留不可变审计记录。 */
export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const id = parseSessionId(params);
  if (!id.success) {
    return NextResponse.json(apiError(ErrorCode.VALIDATION_FAILED, id.error.issues[0].message), {
      status: 400,
    });
  }

  try {
    const service = new ChatSessionService();
    if (!service.getLatest(id.data)) {
      return NextResponse.json(apiError(ErrorCode.NOT_FOUND, "会话不存在"), { status: 404 });
    }
    service.appendDeleted(id.data);
    return NextResponse.json(apiResponse({ sessionId: id.data, deleted: true }));
  } catch (error) {
    return NextResponse.json(apiError(ErrorCode.INTERNAL_ERROR, (error as Error).message), {
      status: 500,
    });
  }
}
