import { NextRequest, NextResponse } from "next/server";
import { AuditReviewer } from "../../../../features/audit/reviewer";

export async function GET() {
  const reviewer = new AuditReviewer();
  const conflicts = await reviewer.listConflicts();
  return NextResponse.json(conflicts);
}

export async function POST(request: NextRequest) {
  const { conflictId, resolution, mergedContent } = await request.json();

  if (!conflictId || !resolution) {
    return NextResponse.json({ error: "conflictId and resolution are required" }, { status: 400 });
  }

  const reviewer = new AuditReviewer();

  try {
    await reviewer.resolveConflict(conflictId, resolution as any, mergedContent);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
