import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/config/skills/import
 *
 * 从 URL 导入技能包配置
 * Body: { url: string }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { url } = body;

    if (!url) {
      return NextResponse.json(
        { success: false, error: "URL 不能为空" },
        { status: 400 }
      );
    }

    // 验证 URL 格式
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch {
      return NextResponse.json(
        { success: false, error: "无效的 URL 格式" },
        { status: 400 }
      );
    }

    // 只允许 http/https
    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      return NextResponse.json(
        { success: false, error: "只支持 HTTP/HTTPS URL" },
        { status: 400 }
      );
    }

    // 获取远程内容（设置超时）
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    let response;
    try {
      response = await fetch(url, {
        signal: controller.signal,
        headers: { "Accept": "application/json" },
        redirect: "follow",
      });
    } catch (fetchError: unknown) {
      clearTimeout(timeout);
      const err = fetchError as Error;
      if (err.name === "AbortError") {
        return NextResponse.json(
          { success: false, error: "请求超时（15秒），请检查 URL 是否可访问" }
        );
      }
      return NextResponse.json(
        { success: false, error: `网络错误: ${err.message}` }
      );
    }

    clearTimeout(timeout);

    if (!response.ok) {
      return NextResponse.json(
        { success: false, error: `HTTP ${response.status}: 无法获取资源` }
      );
    }

    // 解析 JSON
    let data;
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("json")) {
      data = await response.json();
    } else {
      // 尝试将文本解析为 JSON
      const text = await response.text();
      try {
        data = JSON.parse(text);
      } catch {
        return NextResponse.json(
          { success: false, error: "远程内容不是有效的 JSON 格式" }
        );
      }
    }

    // 支持数组或单个对象
    const items = Array.isArray(data) ? data : [data];
    let imported = 0;
    const errors: string[] = [];

    for (const item of items) {
      if (!item.name || !item.trigger || !item.prompt) {
        errors.push(`缺少必要字段 (name/trigger/prompt): ${item.name || "未命名"}`);
        continue;
      }

      // 写入数据库（通过内部 API 调用）
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
      const saveRes = await fetch(`${baseUrl}/api/config/skills`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: item.name,
          trigger: item.trigger,
          prompt: item.prompt,
          enabled: item.enabled !== false,
          description: item.description || "",
        }),
      });

      if (saveRes.ok) {
        imported++;
      } else {
        errors.push(`保存失败: ${item.name}`);
      }
    }

    return NextResponse.json({
      success: true,
      imported,
      total: items.length,
      errors: errors.length > 0 ? errors : undefined,
      message: `成功导入 ${imported} 个技能`,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: "服务器内部错误" },
      { status: 500 }
    );
  }
}
