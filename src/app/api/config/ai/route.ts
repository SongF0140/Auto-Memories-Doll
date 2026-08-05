import { NextRequest, NextResponse } from "next/server";
import { ConfigService } from "../../../../server/services/config-service";
import { aiConfigSchema } from "../../../../lib/validation";

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
    const body = await request.json();
    const parsed = aiConfigSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    service.setAiConfig(parsed.data);
    return NextResponse.json({ success: true });
  } finally {
    service.close();
  }
}
