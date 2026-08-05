import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AuditReviewer } from "../../../../features/audit/reviewer";

const conflictResolveSchema = z.object({
  conflictId: z.string().min(1),
  resolution: z.enum(["accept", "keep", "manual"]),
  mergedContent: z.string().optional(),
});

export async function GET() {
  const reviewer = new AuditReviewer();
  const conflicts = await reviewer.listConflicts();
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

  const { conflictId, resolution, mergedContent } = parsed.data;
  const reviewer = new AuditReviewer();

  try {
    await reviewer.resolveConflict(conflictId, resolution, mergedContent);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
