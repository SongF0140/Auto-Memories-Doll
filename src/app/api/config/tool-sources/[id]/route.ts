import { NextRequest, NextResponse } from "next/server";
import { ConfigService } from "../../../../../server/services/config-service";
import { restartToolDirWatcher } from "../../../../../server/watchers/tool-dir-watcher";

/**
 * PUT /api/config/tool-sources/:id
 * 更新监听源，并重启 watcher。
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体必须是合法的 JSON" }, { status: 400 });
  }

  const service = new ConfigService();
  try {
    const updated = service.updateToolSource(params.id, body as Record<string, unknown>);
    if (!updated) {
      return NextResponse.json({ error: "监听源不存在" }, { status: 404 });
    }

    restartToolDirWatcher().catch((e) => {
      console.error("[ToolSources] 重启 watcher 失败:", e);
    });

    return NextResponse.json(updated);
  } finally {
    service.close();
  }
}

/**
 * DELETE /api/config/tool-sources/:id
 * 删除监听源，并重启 watcher。
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  const service = new ConfigService();
  try {
    const deleted = service.deleteToolSource(params.id);
    if (!deleted) {
      return NextResponse.json({ error: "监听源不存在" }, { status: 404 });
    }

    restartToolDirWatcher().catch((e) => {
      console.error("[ToolSources] 重启 watcher 失败:", e);
    });

    return NextResponse.json({ success: true });
  } finally {
    service.close();
  }
}
