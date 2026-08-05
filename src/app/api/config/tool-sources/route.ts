import { NextRequest, NextResponse } from "next/server";
import { ConfigService } from "../../../../server/services/config-service";
import { restartToolDirWatcher } from "../../../../server/watchers/tool-dir-watcher";
import { ToolType } from "../../../../types/config";
import { TOOL_PRESETS } from "../../../../config/tool-presets";
import { logger } from "../../../../lib/logger";

const VALID_TOOL_TYPES: ToolType[] = ["codex", "claude-code", "cursor", "markdown", "text"];

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

  const { name, toolType, path, filePattern, enabled = true, topic, description } = body as {
    name?: string;
    toolType?: string;
    path?: string;
    filePattern?: string;
    enabled?: boolean;
    topic?: string;
    description?: string;
  };

  if (!name || !name.trim()) {
    return NextResponse.json({ error: "name 不能为空" }, { status: 400 });
  }
  if (!toolType || !VALID_TOOL_TYPES.includes(toolType as ToolType)) {
    return NextResponse.json(
      { error: `toolType 必须是: ${VALID_TOOL_TYPES.join(", ")}` },
      { status: 400 },
    );
  }
  if (!path || !path.trim()) {
    return NextResponse.json({ error: "path 不能为空" }, { status: 400 });
  }

  const service = new ConfigService();
  try {
    const created = service.createToolSource({
      name: name.trim(),
      toolType: toolType as ToolType,
      path: path.trim(),
      filePattern: filePattern || "*.jsonl",
      enabled,
      topic: topic?.trim() || undefined,
      description: description?.trim() || undefined,
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
