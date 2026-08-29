import { NextRequest, NextResponse } from "next/server";
import { ConfigService } from "../../../../server/services/config-service";
import { aiConfigSchema } from "../../../../lib/validation";
import { loadProviderCatalog } from "../../../../config/provider-loader";

export async function GET() {
  const service = new ConfigService();
  try {
    const config = service.getAiConfig() || service.getDefaultAiConfig();
    // 脱敏：前端永远不返回真实 apiKey（共享与 embedding 专属都脱敏）
    const safe = {
      ...config,
      apiKey: config.apiKey ? `****${config.apiKey.slice(-4)}` : "",
      embedding: {
        ...config.embedding,
        apiKey: config.embedding.apiKey ? `****${config.embedding.apiKey.slice(-4)}` : "",
      },
    };
    return NextResponse.json({ ...safe, providerCatalog: loadProviderCatalog() });
  } finally {
    service.close();
  }
}

/** 脱敏 apiKey 回填：`****`+尾4位 与库存值匹配则换回真实 key */
function resolveMaskedKey(incoming: string | undefined, stored: string | undefined): string | undefined {
  if (
    stored &&
    incoming &&
    incoming.startsWith("****") &&
    incoming.slice(-4) === stored.slice(-4)
  ) {
    return stored;
  }
  return incoming;
}

export async function POST(request: NextRequest) {
  const service = new ConfigService();
  try {
    const body = await request.json();
    // 如果前端传的是脱敏后的值，合并数据库中已有的真实 apiKey
    const existing = service.getAiConfig();
    if (existing) {
      body.apiKey = resolveMaskedKey(body.apiKey, existing.apiKey);
      body.embedding = {
        ...body.embedding,
        apiKey: resolveMaskedKey(body.embedding?.apiKey, existing.embedding?.apiKey),
      };
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
