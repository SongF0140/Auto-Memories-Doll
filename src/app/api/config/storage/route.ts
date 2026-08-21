import { NextRequest, NextResponse } from "next/server";
import { ConfigService } from "../../../../server/services/config-service";
import { StorageMigrationService } from "../../../../server/services/storage-migration-service";
import { getDatabasePath } from "../../../../lib/storage/path-resolver";
import { logger } from "../../../../lib/logger";
import { storageConfigPreviewSchema, storageConfigUpdateSchema } from "../../../../lib/validation";


/**
 * GET /api/config/storage
 * 返回当前存储配置：笔记路径 + 数据库路径
 */
export async function GET() {
  const service = new ConfigService();
  try {
    const config = service.getStorageConfig() || service.getDefaultStorageConfig();
    return NextResponse.json({
      notesPath: config.notesPath,
      databasePath: getDatabasePath(),
      updatedAt: config.updatedAt,
    });
  } finally {
    service.close();
  }
}

/**
 * POST /api/config/storage
 * 修改笔记存储路径并执行热迁移。
 *
 * Body:
 *   - notesPath: string     新的笔记根目录（绝对路径或相对 cwd 的路径）
 *   - copyExisting: boolean 是否复制现有笔记到新路径（默认 true）
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体必须是合法的 JSON" }, { status: 400 });
  }

  const parsed = storageConfigUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const { notesPath, copyExisting } = parsed.data;

  const migrationService = new StorageMigrationService();

  try {
    // 先预览，让前端可以展示迁移规模（这里直接执行，前端可单独调 preview）
    const preview = await migrationService.previewMigration(notesPath);

    logger.storage.info("[API] 开始迁移笔记存储路径", {
      from: preview.oldPath,
      to: preview.newPath,
      fileCount: preview.fileCount,
      copyExisting,
    });

    await migrationService.migrate(notesPath, copyExisting);

    return NextResponse.json({
      success: true,
      notesPath,
      migrated: copyExisting,
      fileCount: preview.fileCount,
      totalBytes: preview.totalBytes,
    });
  } catch (error) {
    logger.storage.error("[API] 笔记路径迁移失败", { error: (error as Error).message });
    return NextResponse.json({ error: `迁移失败: ${(error as Error).message}` }, { status: 500 });
  }
}

/**
 * PATCH /api/config/storage/preview
 * 预览迁移：不执行实际迁移，只返回将被复制的文件数和大小。
 */
export async function PATCH(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体必须是合法的 JSON" }, { status: 400 });
  }

  const parsed = storageConfigPreviewSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const { notesPath } = parsed.data;

  const migrationService = new StorageMigrationService();
  try {
    const preview = await migrationService.previewMigration(notesPath);
    return NextResponse.json(preview);
  } catch (error) {
    return NextResponse.json({ error: `预览失败: ${(error as Error).message}` }, { status: 500 });
  }
}
