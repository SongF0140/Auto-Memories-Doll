import { NextRequest, NextResponse } from "next/server";
import { ConfigService } from "../../../../server/services/config-service";
import { restartToolDirWatcher } from "../../../../server/watchers/tool-dir-watcher";
import { TOOL_PRESETS } from "../../../../config/tool-presets";
import { logger } from "../../../../lib/logger";
import { toolSourceCreateSchema } from "../../../../lib/validation";

/**
 * GET /api/config/tool-sources
 * 返回所有监听源 + 预设 + 活跃状态
 */
export async function GET() {
  const service = new ConfigService();
  try {
    const sources = service.listToolSources();
    return NextResponse.json({ sources, presets: TOOL_PRESETS });
  } finally {
    service.close();
  }
}

/**
 * POST /api/config/tool-sources
 * 创建新监听源，并重启 watcher。
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体必须是合法的 JSON" }, { status: 400 });
  }

  const parsed = toolSourceCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const { name, toolType, path, filePattern, enabled, topic, description } = parsed.data;

  const service = new ConfigService();
  try {
    const created = service.createToolSource({
      name,
      toolType,
      path,
      filePattern,
      enabled,
      topic,
      description,
    });

    // 重启 watcher 让新源生效
    restartToolDirWatcher().catch((e) => {
      logger.storage.error("重启 tool-dir-watcher 失败", { error: (e as Error).message });
    });

    return NextResponse.json(created, { status: 201 });
  } finally {
    service.close();
  }
}
