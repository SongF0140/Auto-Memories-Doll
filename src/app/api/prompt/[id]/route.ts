import { NextRequest, NextResponse } from "next/server";
import { PromptManager } from "../../../../features/prompt/manager";
import { promptUpdateSchema } from "../../../../lib/validation";
import { apiResponse, apiError } from "../../../../lib/api-response";
import { ErrorCode } from "../../../../lib/api-errors";
import { TemplateNotFoundError } from "../../../../lib/errors";

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const manager = new PromptManager();
  const template = manager.getTemplate(params.id);

  if (!template) {
    return NextResponse.json(apiError(ErrorCode.PROMPT_NOT_FOUND, `模板不存在: ${params.id}`), { status: 404 });
  }

  return NextResponse.json(apiResponse(template));
}

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(apiError(ErrorCode.INVALID_JSON, "请求体必须是合法的 JSON"), { status: 400 });
  }

  const parsed = promptUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(apiError(ErrorCode.VALIDATION_FAILED, parsed.error.issues[0].message), { status: 400 });
  }

  const manager = new PromptManager();

  try {
    manager.updateTemplate(params.id, parsed.data);
    return NextResponse.json(apiResponse({ id: params.id, success: true }));
  } catch (error) {
    if (error instanceof TemplateNotFoundError) {
      return NextResponse.json(apiError(ErrorCode.PROMPT_NOT_FOUND, `模板不存在: ${params.id}`), { status: 404 });
    }
    return NextResponse.json(apiError(ErrorCode.INTERNAL_ERROR, (error as Error).message), { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  const manager = new PromptManager();

  try {
    manager.deleteTemplate(params.id);
    return NextResponse.json(apiResponse({ id: params.id, success: true }));
  } catch (error) {
    if (error instanceof TemplateNotFoundError) {
      return NextResponse.json(apiError(ErrorCode.PROMPT_NOT_FOUND, `模板不存在: ${params.id}`), { status: 404 });
    }
    return NextResponse.json(apiError(ErrorCode.INTERNAL_ERROR, (error as Error).message), { status: 500 });
  }
}
