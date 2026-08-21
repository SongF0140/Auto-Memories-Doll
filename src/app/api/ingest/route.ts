import { NextRequest, NextResponse } from "next/server";
import { Orchestrator } from "../../../server/services/orchestrator";
import { ingestRequestSchema } from "../../../lib/validation";
import { MemoryValidationError } from "../../../lib/errors";
import { ErrorCode } from "../../../lib/api-errors";
import { apiResponse, apiError } from "../../../lib/api-response";
import { logger } from "../../../lib/logger";


export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(apiError(ErrorCode.INVALID_JSON, "请求体格式无效，需要 JSON"), {
      status: 400,
    });
  }

  const parsed = ingestRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      apiError(ErrorCode.VALIDATION_FAILED, parsed.error.issues[0].message),
      { status: 400 },
    );
  }

  const { content, format } = parsed.data;

  const orchestrator = new Orchestrator();

  try {
    // 文本格式：直接送入 Orchestrator 预处理管线（清洗 → 去重 → 拆包 → 入队）
    const textContent = format === "json" ? content : content;
    const eventId = await orchestrator.processIngest(
      "ingest-api",
      "ingest",
      textContent,
      format === "json" ? "导入的 JSON 数据" : "文本导入",
      "",
      [],
    );

    return NextResponse.json(apiResponse({ eventId, status: "queued" as const }));
  } catch (error) {
    if (error instanceof MemoryValidationError) {
      return NextResponse.json(apiError(ErrorCode.VALIDATION_FAILED, error.message), {
        status: 409,
      });
    }
    const message = error instanceof Error ? error.message : "未知错误";
    logger.api.error("[Ingest] 导入失败:", { message });
    return NextResponse.json(apiError(ErrorCode.INGEST_FAILED, `导入失败: ${message}`), {
      status: 500,
    });
  } finally {
    orchestrator.close();
  }
}
