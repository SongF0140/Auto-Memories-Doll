import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ConfigService } from "../../../../../server/services/config-service";
import { restartToolDirWatcher } from "../../../../../server/watchers/tool-dir-watcher";
import { logger } from "../../../../../lib/logger";
import { toolSourceUpdateSchema } from "../../../../../lib/validation";


const idSchema = z.string().min(1).max(128);

function validateId(params: { id: string }) {
  const parsed = idSchema.safeParse(params.id);
  if (!parsed.success) {
    return NextResponse.json({ error: "无效的 ID" }, { status: 400 });
  }
  return null;
}

/**
 * PUT /api/config/tool-sources/:id
 * 更新监听源，并重启 watcher。
 */
export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const err = validateId(params);
  if (err) return err;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体必须是合法的 JSON" }, { status: 400 });
  }

  const parsed = toolSourceUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const service = new ConfigService();
  try {
    const updated = service.updateToolSource(params.id, parsed.data);
    if (!updated) {
      return NextResponse.json({ error: "监听源不存在" }, { status: 404 });
    }

    restartToolDirWatcher().catch((e) => {
      logger.storage.error("重启 tool-dir-watcher 失败", { error: (e as Error).message });
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
export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  const err = validateId(params);
  if (err) return err;

  const service = new ConfigService();
  try {
    const deleted = service.deleteToolSource(params.id);
    if (!deleted) {
      return NextResponse.json({ error: "监听源不存在" }, { status: 404 });
    }

    restartToolDirWatcher().catch((e) => {
      logger.storage.error("重启 tool-dir-watcher 失败", { error: (e as Error).message });
    });

    return NextResponse.json({ success: true });
  } finally {
    service.close();
  }
}
