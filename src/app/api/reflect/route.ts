import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ReflectService } from "../../../server/services/reflect-service";
import { apiResponse, apiError } from "../../../lib/api-response";
import { ErrorCode } from "../../../lib/api-errors";
import { logger } from "../../../lib/logger";

/** REFLECT_CONTEXT_LIMIT 为 12，超出部分服务端也会截断，这里在边界先行校验 */
const reflectRequestSchema = z.object({
  query: z.string().trim().min(1, "query 不能为空"),
  disposition: z.enum(["balanced", "skeptical", "literal", "empathetic"]).default("balanced"),
  limit: z.number().int().min(1).max(12).default(6),
});

/**
 * Reflect 式推理（对标 Hindsight reflect）：对检索命中的记忆做 disposition-aware
 * 推理，产出带依据标注的答案。只读：不写 accessCount，不落新卡。
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(apiError(ErrorCode.VALIDATION_FAILED, "请求体必须是 JSON"), {
      status: 400,
    });
  }

  const parsed = reflectRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      apiError(ErrorCode.VALIDATION_FAILED, parsed.error.issues[0]?.message || "请求参数校验失败"),
      { status: 400 },
    );
  }
  const { query, disposition, limit } = parsed.data;

  const service = new ReflectService();
  try {
    const result = await service.reflect(query, disposition, limit);
    return NextResponse.json(apiResponse(result));
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    logger.api.error("[Reflect] 推理失败:", { message });
    return NextResponse.json(apiError(ErrorCode.INTERNAL_ERROR, `推理失败: ${message}`), {
      status: 500,
    });
  } finally {
    service.close();
  }
}
