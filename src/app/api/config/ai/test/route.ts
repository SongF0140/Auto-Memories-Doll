import { NextRequest, NextResponse } from "next/server";

type ConnectionResult = {
  success: boolean;
  message: string;
  model?: string;
  dimensions?: number;
};

type TestConnectionOptions = {
  baseURL?: string;
  apiKey?: string;
  model?: string;
};

/**
 * POST /api/config/ai/test
 *
 * 同时测试 Chat 与 Embedding API 连接。
 * Body: {
 *   baseURL, apiKey, model,
 *   embedding: { baseURL?, apiKey?, model? }
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const llm = await testChatConnection({
      baseURL: body.baseURL,
      apiKey: body.apiKey,
      model: body.model,
    });
    const embedding = await testEmbeddingConnection({
      baseURL: body.embedding?.baseURL || body.baseURL,
      apiKey: body.embedding?.apiKey || body.apiKey,
      model: body.embedding?.model,
    });

    return NextResponse.json({
      success: llm.success && embedding.success,
      message: `语言模型：${llm.message}；Embedding：${embedding.message}`,
      llm,
      embedding,
      // 保留旧接口字段，兼容只读取顶层结果的调用方。
      model: llm.model,
      error: llm.success && embedding.success ? undefined : "部分或全部模型连接失败",
    });
  } catch {
    return NextResponse.json({ success: false, error: "服务器内部错误" }, { status: 500 });
  }
}

function normalizeURL(baseURL?: string): string {
  return (baseURL || "https://api.openai.com/v1").replace(/\/$/, "");
}

function getResponseError(status: number, errorData: unknown): string {
  const message =
    typeof errorData === "object" &&
    errorData !== null &&
    "error" in errorData &&
    typeof errorData.error === "object" &&
    errorData.error !== null &&
    "message" in errorData.error
      ? errorData.error.message
      : undefined;

  if (typeof message === "string" && message) return message;
  if (status === 401) return "API Key 无效或已过期";
  if (status === 403) return "API Key 没有访问权限";
  if (status === 404) return "API 端点不正确或模型不存在";
  if (status === 429) return "请求频率超限，请稍后重试";
  return `HTTP ${status}`;
}

async function requestWithTimeout(
  url: string,
  init: RequestInit,
): Promise<{ response?: Response; error?: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    return { response: await fetch(url, { ...init, signal: controller.signal }) };
  } catch (error: unknown) {
    const err = error as Error;
    return {
      error:
        err.name === "AbortError"
          ? "连接超时（10秒），请检查网络和 API 地址"
          : `网络错误: ${err.message}`,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function testChatConnection(options: TestConnectionOptions): Promise<ConnectionResult> {
  const testModel = options.model || "gpt-4o-mini";
  if (!options.apiKey?.trim()) {
    return { success: false, message: "API Key 不能为空", model: testModel };
  }

  const result = await requestWithTimeout(`${normalizeURL(options.baseURL)}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${options.apiKey}`,
    },
    body: JSON.stringify({
      model: testModel,
      messages: [{ role: "user", content: "Hi" }],
      max_tokens: 5,
    }),
  });

  if (result.error) return { success: false, message: result.error, model: testModel };
  if (!result.response) return { success: false, message: "未收到服务响应", model: testModel };
  if (!result.response.ok) {
    const errorData = await result.response.json().catch(() => ({}));
    return {
      success: false,
      message: getResponseError(result.response.status, errorData),
      model: testModel,
    };
  }

  const data = await result.response.json().catch(() => ({}));
  const actualModel = data.model || testModel;
  return { success: true, message: `模型 ${actualModel} 响应正常`, model: actualModel };
}

async function testEmbeddingConnection(
  options: TestConnectionOptions,
): Promise<ConnectionResult> {
  const testModel = options.model || "text-embedding-3-small";
  if (!options.apiKey?.trim()) {
    return { success: false, message: "Embedding API Key 不能为空", model: testModel };
  }

  const result = await requestWithTimeout(`${normalizeURL(options.baseURL)}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${options.apiKey}`,
    },
    body: JSON.stringify({
      model: testModel,
      input: "health-check",
    }),
  });

  if (result.error) return { success: false, message: result.error, model: testModel };
  if (!result.response) return { success: false, message: "未收到服务响应", model: testModel };
  if (!result.response.ok) {
    const errorData = await result.response.json().catch(() => ({}));
    return {
      success: false,
      message: getResponseError(result.response.status, errorData),
      model: testModel,
    };
  }

  const data = await result.response.json().catch(() => ({}));
  const vector = data.data?.[0]?.embedding;
  if (!Array.isArray(vector) || vector.length === 0) {
    return { success: false, message: "服务返回了空向量", model: testModel };
  }

  return {
    success: true,
    message: `模型 ${data.model || testModel} 响应正常（${vector.length} 维）`,
    model: data.model || testModel,
    dimensions: vector.length,
  };
}
