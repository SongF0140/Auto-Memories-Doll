import { NextRequest, NextResponse } from "next/server";
import { AuditReporter } from "../../../features/audit/reporter";
import { AuditReplayer } from "../../../features/audit/replay";
import { AuditReviewer } from "../../../features/audit/reviewer";

export async function GET() {
  const reporter = new AuditReporter();
  const report = await reporter.generateReport();
  return NextResponse.json(report);
}

export async function POST(request: NextRequest) {
  const { action } = await request.json();

  if (action === "replay") {
    const replayer = new AuditReplayer();
    await replayer.replayPendingEvents();
    return NextResponse.json({ success: true, action: "replay" });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
