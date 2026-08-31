import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { getMemoryRoot } from "../../../../lib/storage/path-resolver";
import { recordWrite } from "../../../../lib/storage/write-tracker";
import { ingestMarkdownFile } from "../../../../server/watchers/file-watcher";
import { ErrorCode } from "../../../../lib/api-errors";
import { apiError } from "../../../../lib/api-response";
import { logger } from "../../../../lib/logger";

const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const ALLOWED_EXTS = [".md", ".txt", ".jsonl", ".markdown"];

/** 保留中文、字母、数字、点、横线、下划线，其余替换为横线（防路径穿越与非法文件名） */
function safeFileName(name: string): string {
  const base = name.replace(/[^\p{L}\p{N}._-]+/gu, "-");
  return base.replace(/^(\/|\\)+/, "").slice(0, 120) || "import";
}

/**
 * jsonl 聊天记录 → Markdown：逐行 JSON.parse，
 * 兼容 role/type/sender 侧 + content/text/message 侧字段；非法行按纯文本保留。
 */
function jsonlToMarkdown(raw: string, fileName: string): string {
  const lines: string[] = [`# ${fileName}`, ""];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      const role = String(obj.role ?? obj.type ?? obj.sender ?? "message");
      const content = String(obj.content ?? obj.text ?? obj.message ?? "").trim();
      if (content) {
        lines.push(`**${role}**: ${content}`, "");
      }
    } catch {
      lines.push(trimmed, "");
    }
  }
  return lines.join("\n");
}

/**
 * POST /api/listen/import
 *
 * 导入本地消息记录文件（.md/.markdown/.txt/.jsonl，≤5MB）：
 * 1. jsonl 自动转换为 Markdown；其余直接保存
 * 2. 存入 <memory-root>/imports/<ISO时间戳>-<安全文件名>
 * 3. recordWrite 标记本进程写入（防 FileWatcher 循环采集）
 * 4. 立即按 change 事件采集入队（走统一的质量闸门 + 中文抽取拆卡管线）
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData().catch(() => null);
    if (!formData) {
      return NextResponse.json(
        apiError(ErrorCode.VALIDATION_FAILED, "请求必须是 multipart/form-data 格式"),
        { status: 400 },
      );
    }

    const files = formData.getAll("file").filter((f): f is File => f instanceof File);
    if (files.length === 0) {
      return NextResponse.json(
        apiError(ErrorCode.VALIDATION_FAILED, "缺少 file 字段（可多文件上传）"),
        { status: 400 },
      );
    }

    const importsDir = join(getMemoryRoot(), "imports");
    await mkdir(importsDir, { recursive: true });

    const results: { fileName: string; success: boolean; savedPath?: string; error?: string }[] = [];

    for (const file of files) {
      const fileName = file.name || "import.md";
      const ext = fileName.slice(fileName.lastIndexOf(".")).toLowerCase();
      if (!ALLOWED_EXTS.includes(ext)) {
        results.push({ fileName, success: false, error: `不支持的扩展名 ${ext}` });
        continue;
      }
      if (file.size > MAX_IMPORT_BYTES) {
        results.push({ fileName, success: false, error: "文件超过 5MB 上限" });
        continue;
      }

      try {
        const raw = await file.text();
        const content = ext === ".jsonl" ? jsonlToMarkdown(raw, fileName) : raw;
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        const base = safeFileName(fileName.slice(0, fileName.lastIndexOf(".")) || fileName);
        const savedPath = join(importsDir, `${stamp}-${base}.md`);

        await writeFile(savedPath, content, "utf-8");
        // 标记为本进程写入：FileWatcher 的 add 事件会因此跳过，避免双入队
        recordWrite(savedPath);
        // 立即采集入队（内容级跳过保证重复导入同一文件不会重复入库）
        await ingestMarkdownFile(savedPath, "change");

        results.push({ fileName, success: true, savedPath });
        logger.ingest.info(`[Import] 已导入文件: ${fileName} → ${savedPath}`);
      } catch (fileError) {
        results.push({
          fileName,
          success: false,
          error: fileError instanceof Error ? fileError.message : String(fileError),
        });
      }
    }

    const okCount = results.filter((r) => r.success).length;
    return NextResponse.json({
      success: okCount > 0,
      imported: okCount,
      total: results.length,
      results,
      message: `成功导入 ${okCount}/${results.length} 个文件，已进入记忆处理队列`,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    logger.api.error("POST /api/listen/import 处理失败", {
      message: detail,
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json(apiError(ErrorCode.INTERNAL_ERROR, "导入失败"), { status: 500 });
  }
}
