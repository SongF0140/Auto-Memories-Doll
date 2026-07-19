import { NextRequest, NextResponse } from "next/server";
import { ConfigService } from "../../../../server/services/config-service";
import { AiConfig } from "../../../../types/config";

export async function GET() {
  const service = new ConfigService();
  try {
    const config = service.getAiConfig() || service.getDefaultAiConfig();
    return NextResponse.json(config);
  } finally {
    service.close();
  }
}

const REQUIRED_STRING_FIELDS: (keyof AiConfig)[] = [
  "baseURL", "apiKey", "chatModel", "embeddingModel",
];

const REQUIRED_NUMBER_FIELDS: { field: keyof AiConfig; min: number; max: number }[] = [
  { field: "embeddingDimensions", min: 1, max: 8192 },
  { field: "maxTokens", min: 1, max: 131072 },
  { field: "temperature", min: 0, max: 2 },
  { field: "timeout", min: 1000, max: 120000 },
  { field: "maxRetries", min: 0, max: 10 },
];

function validateAiConfig(body: any): { valid: true; config: AiConfig } | { valid: false; error: string } {
  for (const field of REQUIRED_STRING_FIELDS) {
    if (!body[field] || typeof body[field] !== "string") {
      return { valid: false, error: `"${field}" is required and must be a string` };
    }
  }

  for (const { field, min, max } of REQUIRED_NUMBER_FIELDS) {
    const value = Number(body[field]);
    if (isNaN(value) || value < min || value > max) {
      return { valid: false, error: `"${field}" must be a number between ${min} and ${max}` };
    }
  }

  const provider = body.provider;
  if (!["openai", "openai-compatible", "anthropic", "custom"].includes(provider)) {
    return { valid: false, error: `"provider" must be one of: openai, openai-compatible, anthropic, custom` };
  }

  return {
    valid: true,
    config: {
      provider,
      baseURL: body.baseURL,
      apiKey: body.apiKey,
      chatModel: body.chatModel,
      embeddingModel: body.embeddingModel,
      embeddingDimensions: Number(body.embeddingDimensions),
      maxTokens: Number(body.maxTokens),
      temperature: Number(body.temperature),
      timeout: Number(body.timeout),
      maxRetries: Number(body.maxRetries),
    },
  };
}

export async function POST(request: NextRequest) {
  const service = new ConfigService();
  try {
    const body = await request.json();
    const result = validateAiConfig(body);

    if (!result.valid) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    service.setAiConfig(result.config);
    return NextResponse.json({ success: true });
  } finally {
    service.close();
  }
}
