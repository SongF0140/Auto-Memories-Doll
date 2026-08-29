"use client";

/* eslint-disable no-console -- 工具监听操作失败需要保留浏览器端诊断信息。 */

import { useState } from "react";
import { ToolWatchSource, ToolType } from "../../types/config";

type Preset = {
  name: string;
  toolType: ToolType;
  path: string;
  filePattern: string;
};

interface ToolSourceListProps {
  sources: ToolWatchSource[];
  presets: Record<string, Preset>;
  onChange: (sources: ToolWatchSource[]) => void;
}

const TOOL_TYPE_LABELS: Record<ToolType, string> = {
  codex: "Codex CLI",
  "claude-code": "Claude Code",
  cursor: "Cursor",
  trae: "Trae",
  markdown: "Markdown",
  text: "纯文本",
};

export default function ToolSourceList({ sources, presets, onChange }: ToolSourceListProps) {
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({
    name: "",
    toolType: "codex" as ToolType,
    path: "",
    filePattern: "*.jsonl",
    topic: "",
    description: "",
  });
  const [error, setError] = useState("");

  const applyPreset = (presetKey: string) => {
    const preset = presets[presetKey];
    if (!preset) return;
    setForm({
      name: preset.name,
      toolType: preset.toolType,
      path: preset.path,
      filePattern: preset.filePattern,
      topic: "",
      description: "",
    });
    setError("");
  };

  const handleAdd = async () => {
    if (!form.name.trim() || !form.path.trim()) {
      setError("名称和路径不能为空");
      return;
    }
    setError("");
    try {
      const res = await fetch("/api/config/tool-sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          toolType: form.toolType,
          path: form.path.trim(),
          filePattern: form.filePattern.trim() || "*.jsonl",
          enabled: true,
          topic: form.topic.trim() || undefined,
          description: form.description.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        onChange([data, ...sources]);
        setShowAdd(false);
        setForm({
          name: "",
          toolType: "codex",
          path: "",
          filePattern: "*.jsonl",
          topic: "",
          description: "",
        });
      } else {
        setError(data.error || "创建失败");
      }
    } catch (e) {
      setError(`创建失败: ${(e as Error).message}`);
    }
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    try {
      const res = await fetch(`/api/config/tool-sources/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !enabled }),
      });
      if (res.ok) {
        const updated = await res.json();
        onChange(sources.map((s) => (s.id === id ? updated : s)));
      }
    } catch (e) {
      console.error("切换失败:", e);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("确定删除这个监听源吗？")) return;
    try {
      const res = await fetch(`/api/config/tool-sources/${id}`, { method: "DELETE" });
      if (res.ok) {
        onChange(sources.filter((s) => s.id !== id));
      }
    } catch (e) {
      console.error("删除失败:", e);
    }
  };

  return (
    <div className="space-y-4">
      {/* 预设快速添加 */}
      {!showAdd && (
        <div className="flex flex-wrap gap-2">
          {Object.entries(presets).map(([key, preset]) => (
            <button
              key={key}
              onClick={() => {
                applyPreset(key);
                setShowAdd(true);
              }}
              className="px-3 py-1.5 rounded-lg border border-border bg-surface text-xs text-text-secondary hover:border-accent hover:text-accent transition-colors"
            >
              + {preset.name}
            </button>
          ))}
          <button
            onClick={() => {
              setForm({
                name: "",
                toolType: "markdown",
                path: "",
                filePattern: "*.md",
                topic: "",
                description: "",
              });
              setShowAdd(true);
            }}
            className="px-3 py-1.5 rounded-lg border border-border bg-surface text-xs text-text-secondary hover:border-accent hover:text-accent transition-colors"
          >
            + 自定义
          </button>
        </div>
      )}

      {/* 添加/编辑表单 */}
      {showAdd && (
        <div className="rounded-xl border border-accent/20 bg-accent/[0.03] p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">名称</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Codex CLI"
                className="input h-9 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">工具类型</label>
              <select
                value={form.toolType}
                onChange={(e) => setForm({ ...form, toolType: e.target.value as ToolType })}
                className="input h-9 text-sm"
              >
                {Object.entries(TOOL_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-text-secondary mb-1">监听路径</label>
              <input
                type="text"
                value={form.path}
                onChange={(e) => setForm({ ...form, path: e.target.value })}
                placeholder="~/.codex/sessions 或 D:\my-tool\sessions"
                className="input h-9 text-sm"
              />
              <p className="text-[10px] text-text-tertiary mt-1">
                支持绝对路径或 ~ 开头的家目录路径
              </p>
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">文件模式</label>
              <input
                type="text"
                value={form.filePattern}
                onChange={(e) => setForm({ ...form, filePattern: e.target.value })}
                placeholder="*.jsonl"
                className="input h-9 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">
                归类话题（可选）
              </label>
              <input
                type="text"
                value={form.topic}
                onChange={(e) => setForm({ ...form, topic: e.target.value })}
                placeholder="ai-learning"
                className="input h-9 text-sm"
              />
            </div>
          </div>
          {error && <p className="text-xs text-error">{error}</p>}
          <div className="flex gap-2">
            <button onClick={handleAdd} className="btn h-9 px-4 text-sm">
              创建
            </button>
            <button
              onClick={() => {
                setShowAdd(false);
                setError("");
              }}
              className="btn-secondary h-9 px-4 text-sm"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* 监听源列表 */}
      {sources.length === 0 && !showAdd ? (
        <p className="text-sm text-text-tertiary py-4 text-center">
          还没有监听源。点击上方预设快速添加，或添加自定义源。
        </p>
      ) : (
        <div className="space-y-2">
          {sources.map((source) => (
            <div
              key={source.id}
              className="rounded-xl border border-border bg-surface p-4 flex items-start justify-between gap-3"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-medium text-text-primary">{source.name}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-text-tertiary">
                    {TOOL_TYPE_LABELS[source.toolType]}
                  </span>
                  {source.topic && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/10 text-accent">
                      #{source.topic}
                    </span>
                  )}
                </div>
                <p className="text-xs text-text-secondary font-mono break-all">{source.path}</p>
                <p className="text-[10px] text-text-tertiary mt-1">
                  模式: {source.filePattern}
                  {source.description ? ` · ${source.description}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => handleToggle(source.id, source.enabled)}
                  className={`relative h-5 w-9 rounded-full transition-colors ${
                    source.enabled ? "bg-accent" : "bg-muted"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
                      source.enabled ? "translate-x-4" : "translate-x-0.5"
                    }`}
                  />
                </button>
                <button
                  onClick={() => handleDelete(source.id)}
                  className="text-text-tertiary hover:text-error transition-colors text-xs px-2"
                >
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
