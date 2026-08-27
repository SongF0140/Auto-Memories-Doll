import { NextResponse } from "next/server";
import { ModelAdapter } from "../../../lib/ai/model-adapter";

export async function GET() {
  return NextResponse.json({
    degraded: ModelAdapter.isDegradedMode,
    timestamp: Date.now(),
  });
}
