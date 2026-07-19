import { NextRequest, NextResponse } from "next/server";
import { ConfigService } from "../../../../server/services/config-service";

export async function GET() {
  const service = new ConfigService();
  try {
    const config = service.getAiConfig() || service.getDefaultAiConfig();
    return NextResponse.json(config);
  } finally {
    service.close();
  }
}

export async function POST(request: NextRequest) {
  const service = new ConfigService();
  try {
    const config = await request.json();

    if (!config.baseURL || !config.chatModel) {
      return NextResponse.json(
        { error: "baseURL and chatModel are required" },
        { status: 400 }
      );
    }

    service.setAiConfig(config);
    return NextResponse.json({ success: true });
  } finally {
    service.close();
  }
}
