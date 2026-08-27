"use client";

import { useState } from "react";

type StorageConfig = {
  notesPath: string;
  databasePath: string;
  updatedAt: string;
};

type PreviewResult = {
  fileCount: number;
  totalBytes: number;
  oldPath: string;
  newPath: string;
};

interface StorageConfigFormProps {
  config: StorageConfig;
  onChanged?: () => void;
}

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
};

export default function StorageConfigForm({ config, onChanged }: StorageConfigFormProps) {
  const [newPath, setNewPath] = useState("");
  const [copyExisting, setCopyExisting] = useState(true);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const handlePreview = async () => {
    if (!newPath.trim()) {
      setError("请输入新路径");
      return;
    }
    setPreviewing(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch("/api/config/storage", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notesPath: newPath.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setPreview(data);
      } else {
        setError(data.error || "预览失败");
      }
    } catch (e) {
      setError(`预览失败: ${(e as Error).message}`);
    } finally {
      setPreviewing(false);
    }
  };

  const handleSave = async () => {
    if (!newPath.trim()) {
      setError("请输入新路径");
      return;
    }
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch("/api/config/storage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notesPath: newPath.trim(),
          copyExisting,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        const msg = copyExisting
          ? `已迁移 ${data.fileCount} 个文件到 ${newPath.trim()}`
          : `已切换笔记路径到 ${newPath.trim()}`;
        setSuccess(msg);
        setNewPath("");
        setPreview(null);
        onChanged?.();
      } else {
        setError(data.error || "保存失败");
      }
    } catch (e) {
      setError(`保存失败: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* 当前路径展示 */}
      <div className="space-y-3">
        <div className="rounded-xl border border-border bg-muted/30 p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-text-primary">当前笔记路径</span>
            <span className="text-[11px] text-text-tertiary font-mono">可热重载</span>
          </div>
          <p className="text-sm text-text-secondary font-mono break-all">{config.notesPath}</p>
        </div>

        <div className="rounded-xl border border-border bg-muted/30 p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-text-primary">数据库路径</span>
            <span className="text-[11px] text-text-tertiary font-mono">固定</span>
          </div>
          <p className="text-sm text-text-secondary font-mono break-all">{config.databasePath}</p>
          <p className="text-[11px] text-text-tertiary mt-2">
            数据库始终留在启动时确定的位置（env.MEMORY_ROOT），不随笔记路径迁移，避免 SQLITE_BUSY。
          </p>
        </div>
      </div>

      {/* 路径修改 */}
      <div className="space-y-4 pt-4 border-t border-border">
        <div>
          <label className="block text-sm font-medium text-text-primary mb-2">新笔记路径</label>
          <input
            type="text"
            value={newPath}
            onChange={(e) => {
              setNewPath(e.target.value);
              setPreview(null);
              setError("");
            }}
            placeholder="D:\my-notes 或 ./memory-root"
            className="input"
          />
          <p className="text-[11px] text-text-tertiary mt-1.5">
            支持绝对路径（推荐放 D 盘大容量分区）或相对项目根目录的路径
          </p>
        </div>

        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={copyExisting}
            onChange={(e) => setCopyExisting(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-border"
          />
          <div>
            <span className="text-sm font-medium text-text-primary">迁移现有笔记</span>
            <p className="text-[11px] text-text-tertiary mt-0.5">
              将当前路径下的所有笔记复制到新路径（数据库文件不迁移）
            </p>
          </div>
        </label>

        {/* 预览结果 */}
        {preview && (
          <div className="rounded-xl border border-accent/20 bg-accent/[0.03] p-4">
            <p className="text-sm font-medium text-text-primary mb-2">迁移预览</p>
            <div className="space-y-1 text-xs text-text-secondary">
              <p>
                <span className="text-text-tertiary">从：</span>
                <span className="font-mono break-all">{preview.oldPath}</span>
              </p>
              <p>
                <span className="text-text-tertiary">到：</span>
                <span className="font-mono break-all">{preview.newPath}</span>
              </p>
              <p>
                <span className="text-text-tertiary">文件数：</span>
                {preview.fileCount} 个<span className="ml-3 text-text-tertiary">大小：</span>
                {formatBytes(preview.totalBytes)}
              </p>
            </div>
          </div>
        )}

        {/* 错误/成功提示 */}
        {error && (
          <div className="rounded-lg border border-error-bg bg-error-bg px-4 py-2.5 text-sm text-error">
            {error}
          </div>
        )}
        {success && (
          <div className="rounded-lg border border-success-bg bg-success-bg px-4 py-2.5 text-sm text-success">
            {success}
          </div>
        )}

        {/* 操作按钮 */}
        <div className="flex gap-2">
          <button
            onClick={handlePreview}
            disabled={previewing || !newPath.trim()}
            className="btn-secondary h-10 px-4 text-sm"
          >
            {previewing ? "预览中..." : "预览"}
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !newPath.trim()}
            className="btn h-10 px-5 text-sm"
          >
            {saving ? "迁移中..." : copyExisting ? "迁移并切换" : "切换路径"}
          </button>
        </div>
      </div>
    </div>
  );
}
