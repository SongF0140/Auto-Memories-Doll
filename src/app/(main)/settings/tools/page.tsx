"use client";

import { useCallback, useEffect, useState } from "react";
import { ToolWatchSource, ToolType } from "@/types/config";
import ToolSourceList from "@/components/settings/ToolSourceList";

const API_BASE = "/api/config";

type Preset = { name: string; toolType: ToolType; path: string; filePattern: string };

type WatchStatus = {
  fileWatcher: { running: boolean; root: string };
  toolWatcher: {
    configured: number;
    running: number;
    sources: { id: string; name: string; toolType: string; path: string }[];
  };
  events: { pending: number; review: number; failed: number };
};

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${
        ok ? "bg-green-500/10 text-green-600" : "bg-red-500/10 text-red-600"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-green-500" : "bg-red-500"}`} />
      {label}
    </span>
  );
}

export default function ToolSourcesPage() {
  const [sources, setSources] = useState<ToolWatchSource[]>([]);
  const [presets, setPresets] = useState<Record<string, Preset>>({});
  const [status, setStatus] = useState<WatchStatus | null>(null);

  const refresh = useCallback(() => {
    fetch(`${API_BASE}/tool-sources`)
      .then((r) => r.json())
      .then((d) => {
        setSources(d.sources || []);
        setPresets(d.presets || {});
      })
      .catch(() => {});
    fetch(`${API_BASE}/tool-sources/status`)
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => {});
  }, []);

  useEffect(() => {
    document.title = "工具监听 | Auto-Memeries-Doll";
    refresh();
  }, [refresh]);

  return (
    <div className="p-6 md:p-10 max-w-3xl mx-auto space-y-6">
      <div className="card p-6">
        <h2 className="text-lg font-semibold text-text-primary mb-1">运行状态</h2>
        <p className="text-xs text-text-tertiary mb-4">
          监听器与采集队列的实时情况（配置变更后自动刷新）
        </p>
        <div className="space-y-3 text-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-text-secondary">文件监听</p>
              <p className="text-xs text-text-tertiary font-mono break-all">
                {status?.fileWatcher.root || "—"}
              </p>
            </div>
            <StatusBadge
              ok={!!status?.fileWatcher.running}
              label={status?.fileWatcher.running ? "运行中" : "未运行"}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-text-secondary">工具目录监听</p>
              <p className="text-xs text-text-tertiary">
                {status
                  ? status.toolWatcher.running > 0
                    ? `${status.toolWatcher.running} 个源监听中`
                    : status.toolWatcher.configured > 0
                      ? "已配置但未运行，重启服务后生效"
                      : "尚未配置监听源"
                  : "—"}
              </p>
            </div>
            <StatusBadge
              ok={(status?.toolWatcher.running ?? 0) > 0}
              label={
                status
                  ? `${status.toolWatcher.running} / ${status.toolWatcher.configured} 活跃`
                  : "—"
              }
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-text-secondary">采集队列</p>
              <p className="text-xs text-text-tertiary">
                待处理 {status?.events.pending ?? 0} · 失败 {status?.events.failed ?? 0}
                {(status?.events.review ?? 0) > 0 && (
                  <>
                    {" · "}
                    <a href="/audit" className="text-accent hover:underline">
                      {status?.events.review} 条待人工裁决，去审计页处理 →
                    </a>
                  </>
                )}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="card p-6">
        <h2 className="text-lg font-semibold text-text-primary mb-1">工具监听</h2>
        <p className="text-xs text-text-tertiary mb-6">配置 IDE/AI 工具的工作目录监听源</p>
        <ToolSourceList sources={sources} presets={presets} onChange={refresh} />
      </div>
    </div>
  );
}
