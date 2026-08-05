import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AuditReporter } from "../../../features/audit/reporter";
import { AuditReplayer } from "../../../features/audit/replay";

const auditActionSchema = z.object({
  action: z.enum(["replay"]),
});

export async function GET() {
  const reporter = new AuditReporter();
  const report = await reporter.generateReport();
  return NextResponse.json(report);
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体必须是合法的 JSON" }, { status: 400 });
  }

  const parsed = auditActionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { action } = parsed.data;

  if (action === "replay") {
    const replayer = new AuditReplayer();
    await replayer.replayPendingEvents();
    return NextResponse.json({ success: true, action: "replay" });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
