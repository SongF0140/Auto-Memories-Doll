import { NextRequest, NextResponse } from "next/server";
import { ConfigService } from "../../../../server/services/config-service";
import { aiConfigSchema } from "../../../../lib/validation";

export async function GET() {
  const service = new ConfigService();
  try {
    const config = service.getAiConfig() || service.getDefaultAiConfig();
    // 脱敏：前端永远不返回真实 apiKey
    const safe = { ...config, apiKey: config.apiKey ? `****${config.apiKey.slice(-4)}` : "" };
    return NextResponse.json(safe);
  } finally {
    service.close();
  }
}

export async function POST(request: NextRequest) {
  const service = new ConfigService();
  try {
    const body = await request.json();
    // 如果前端传的是脱敏后的值，合并数据库中已有的真实 apiKey
    const existing = service.getAiConfig();
    if (
      existing?.apiKey &&
      body.apiKey &&
      body.apiKey.startsWith("****") &&
      body.apiKey.slice(-4) === existing.apiKey.slice(-4)
    ) {
      body.apiKey = existing.apiKey;
    }

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
