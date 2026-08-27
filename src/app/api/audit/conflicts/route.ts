import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AuditReviewer } from "../../../../features/audit/reviewer";
import { Orchestrator } from "../../../../server/services/orchestrator";

const conflictResolveSchema = z
  .object({
    conflictId: z.string().min(1),
    resolution: z.enum(["accept", "keep", "manual"]),
    manualValue: z.string().optional(),
    // 兼容旧客户端；新客户端统一使用 manualValue。
    mergedContent: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    if (
      value.resolution === "manual" &&
      value.manualValue === undefined &&
      value.mergedContent === undefined
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["manualValue"],
        message: "手动解决冲突时必须提供 manualValue",
      });
    }
  });

export async function GET() {
  const reviewer = new AuditReviewer();
  const conflicts = await reviewer.listConflicts("pending");
  return NextResponse.json(conflicts);
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体必须是合法的 JSON" }, { status: 400 });
  }

  const parsed = conflictResolveSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { conflictId, resolution, manualValue, mergedContent } = parsed.data;
  const orchestrator = new Orchestrator();

  try {
    const memory = await orchestrator.resolveConflict(
      conflictId,
      resolution,
      manualValue ?? mergedContent,
    );
    return NextResponse.json({ success: true, memory });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  } finally {
    orchestrator.close();
  }
}
