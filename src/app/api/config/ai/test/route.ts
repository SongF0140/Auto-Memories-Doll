import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/config/ai/test
 *
 * 测试 AI API 连接是否可用
 * Body: { provider, baseURL, apiKey, model }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { provider, baseURL, apiKey, model } = body;

    if (!apiKey) {
      return NextResponse.json(
        { success: false, error: "API Key 不能为空" },
        { status: 400 }
      );
    }

    const url = (baseURL || "https://api.openai.com/v1").replace(/\/$/, "");
    const testModel = model || "gpt-4o-mini";

    // 发送简单的 chat completion 请求来测试连接
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000); // 10秒超时

    try {
      const response = await fetch(`${url}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: testModel,
          messages: [{ role: "user", content: "Hi" }],
          max_tokens: 5,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (response.ok) {
        const data = await response.json();
        return NextResponse.json({
          success: true,
          message: `连接成功！模型 ${data.model || testModel} 响应正常`,
          model: data.model || testModel,
        });
      } else {
        const errorData = await response.json().catch(() => ({}));
        let errorMsg = `HTTP ${response.status}`;

        if (errorData.error?.message) {
          errorMsg = errorData.error.message;
        } else if (response.status === 401) {
          errorMsg = "API Key 无效或已过期";
        } else if (response.status === 403) {
          errorMsg = "API Key 没有访问权限";
        } else if (response.status === 404) {
          errorMsg = "API 端点不正确或模型不存在";
        } else if (response.status === 429) {
          errorMsg = "请求频率超限，请稍后重试";
        }

        return NextResponse.json(
          { success: false, error: errorMsg },
          { status: 200 } // 返回200让前端能读取错误信息
        );
      }
    } catch (fetchError: unknown) {
      clearTimeout(timeout);

      const err = fetchError as Error;
      if (err.name === "AbortError") {
        return NextResponse.json(
          { success: false, error: "连接超时（10秒），请检查网络和 API 地址" },
          { status: 200 }
        );
      }

        return NextResponse.json(
          { success: false, error: `网络错误: ${err.message}` },
          { status: 200 }
        );
    }
  } catch (error) {
    return NextResponse.json(
      { success: false, error: "服务器内部错误" },
      { status: 500 }
    );
  }
}
