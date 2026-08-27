import { NextRequest, NextResponse } from "next/server";
import { PromptManager } from "../../../features/prompt/manager";
import { promptCreateSchema } from "../../../lib/validation";
import { apiResponse, apiError } from "../../../lib/api-response";
import { ErrorCode } from "../../../lib/api-errors";
import { TemplateConflictError } from "../../../lib/errors";

export async function GET() {
  const manager = new PromptManager();
  const templates = manager.listTemplates();
  return NextResponse.json(apiResponse(templates));
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(apiError(ErrorCode.INVALID_JSON, "请求体必须是合法的 JSON"), {
      status: 400,
    });
  }

  const parsed = promptCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      apiError(ErrorCode.VALIDATION_FAILED, parsed.error.issues[0].message),
      { status: 400 },
    );
  }

  const { id, name, content, variables, description } = parsed.data;
  const manager = new PromptManager();

  try {
    manager.addTemplate({ id, name, content, variables, description });
    return NextResponse.json(apiResponse({ id, success: true }), { status: 201 });
  } catch (error) {
    if (error instanceof TemplateConflictError) {
      return NextResponse.json(
        apiError(ErrorCode.PROMPT_CREATE_FAILED, `模板已存在: ${error.message}`),
        { status: 409 },
      );
    }
    return NextResponse.json(apiError(ErrorCode.PROMPT_CREATE_FAILED, (error as Error).message), {
      status: 500,
    });
  }
}
