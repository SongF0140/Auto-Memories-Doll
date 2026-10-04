import { NextRequest, NextResponse } from "next/server";
import type { AiConfig } from "../../../../types/config";
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
      apiKey: maskKey(config.apiKey),
      embedding: { ...config.embedding, apiKey: maskKey(config.embedding.apiKey) },
    };
    return NextResponse.json({ ...safe, providerCatalog: loadProviderCatalog() });
  } finally {
    service.close();
  }
}

/** 脱敏：Key 足够长才保留尾4位；短 Key 整体隐藏，避免掩码本身泄露完整 Key */
function maskKey(key: string | undefined): string {
  if (!key) return "";
  return key.length > 4 ? `****${key.slice(-4)}` : "****";
}

/** 掩码形态的 apiKey 与库存匹配则换回真实 key；不匹配返回 null（由上层拒绝） */
function resolveMaskedKey(incoming: string | undefined, stored: string | undefined): string | null {
  if (
    stored &&
    incoming &&
    incoming.startsWith("****") &&
    incoming.slice(-4) === stored.slice(-4)
  ) {
    return stored;
  }
  return null;
}

export async function POST(request: NextRequest) {
  const service = new ConfigService();
  try {
    const body = await request.json();
    const existing = service.getAiConfig();
    const storedKey = existing?.apiKey ?? "";
    const storedEmbeddingKey = existing?.embedding?.apiKey ?? "";

    // Key 保存意图：保留 / 替换 / 清除。省略意图时按掩码回填，兼容旧客户端。
    if (body.apiKeyIntent === "clear") {
      body.apiKey = "";
    } else if (body.apiKeyIntent === "keep") {
      body.apiKey = storedKey;
    } else if (typeof body.apiKey === "string" && body.apiKey.startsWith("****")) {
      // 掩码形态：匹配库存才回填；不匹配（如 Key 已轮换）必须失败，不能把掩码当真实 Key 入库
      const resolved = resolveMaskedKey(body.apiKey, storedKey);
      if (!resolved) {
        return NextResponse.json(
          { error: "apiKey 为掩码占位但与已存 Key 不匹配，请输入新 Key" },
          { status: 400 },
        );
      }
      body.apiKey = resolved;
    } else {
      body.apiKey = body.apiKey ?? "";
    }
    // 非清除意图不允许空 Key（避免把"清空"伪装成正常保存）
    if (body.apiKeyIntent !== "clear" && !body.apiKey) {
      return NextResponse.json({ error: "apiKey 不能为空" }, { status: 400 });
    }

    if (body.embeddingApiKeyIntent === "clear") {
      body.embedding = { ...(body.embedding || {}), apiKey: "" };
    } else if (body.embeddingApiKeyIntent === "keep") {
      body.embedding = { ...(body.embedding || {}), apiKey: storedEmbeddingKey };
    } else if (
      typeof body.embedding?.apiKey === "string" &&
      body.embedding.apiKey.startsWith("****")
    ) {
      const resolved = resolveMaskedKey(body.embedding.apiKey, storedEmbeddingKey);
      if (!resolved) {
        return NextResponse.json(
          { error: "embedding.apiKey 为掩码占位但与已存 Key 不匹配，请输入新 Key" },
          { status: 400 },
        );
      }
      body.embedding = { ...(body.embedding || {}), apiKey: resolved };
    } else {
      body.embedding = {
        ...(body.embedding || {}),
        apiKey: body.embedding?.apiKey ?? "",
      };
    }

    const parsed = aiConfigSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    // intent 是保存指令，不属于持久配置
    const config = parsed.data as Record<string, unknown>;
    delete config.apiKeyIntent;
    delete config.embeddingApiKeyIntent;
    service.setAiConfig(config as AiConfig);
    return NextResponse.json({ success: true });
  } finally {
    service.close();
  }
}
