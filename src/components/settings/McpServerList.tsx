"use client";

import { useState } from "react";
import { McpServerConfig } from "../../types/config";

interface McpServerListProps {
  servers: McpServerConfig[];
  onChange: (servers: McpServerConfig[]) => void;
}

export default function McpServerList({ servers, onChange }: McpServerListProps) {
  const [editing, setEditing] = useState<Partial<McpServerConfig> | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");

  const save = async (server: Partial<McpServerConfig>) => {
    const isNew = !server.id;
    const method = isNew ? "POST" : "PUT";
    const url = isNew ? "/api/config/mcp" : `/api/config/mcp/${server.id}`;

    const response = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: server.name,
        command: server.command,
        args: server.args,
        env: server.env,
        enabled: server.enabled,
        description: server.description,
      }),
    });

    if (response.ok) {
      setEditing(null);
      refresh();
    }
  };

  const remove = async (id: string) => {
    const response = await fetch(`/api/config/mcp/${id}`, { method: "DELETE" });
    if (response.ok) refresh();
  };

  const refresh = async () => {
    const response = await fetch("/api/config/mcp");
    const data = await response.json();
    onChange(data);
  };

  // JSON 批量导入
  const handleImport = async () => {
    setImporting(true);
    setImportError("");

    try {
      // 尝试解析 JSON
      let parsed;
      try {
        parsed = JSON.parse(importText);
      } catch {
        setImportError("JSON 格式错误，请检查语法");
        setImporting(false);
        return;
      }

      // 支持两种格式：数组或单个对象
      const items = Array.isArray(parsed) ? parsed : [parsed];
      let imported = 0;

      for (const item of items) {
        if (!item.name || !item.command) continue;

        const response = await fetch("/api/config/mcp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: item.name,
            command: item.command,
            args: item.args || [],
            env: item.env || {},
            enabled: item.enabled !== false,
            description: item.description || "",
          }),
        });

        if (response.ok) imported++;
      }

      if (imported > 0) {
        setShowImport(false);
        setImportText("");
        refresh();
      } else {
        setImportError("没有成功导入任何服务器，请确保每项都有 name 和 command");
      }
    } catch (e) {
      setImportError(`导入失败: ${(e as Error).message}`);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* 操作栏 */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-text-tertiary">已配置 {servers.length} 个 MCP 服务</p>
        <div className="flex gap-2">
          <button
            onClick={() => setShowImport(true)}
            className="btn btn-secondary text-sm px-3 py-1.5"
          >
            JSON 导入
          </button>
          <button
            onClick={() => setEditing({ name: "", command: "", args: [], env: {}, enabled: true })}
            className="btn text-sm px-3 py-1.5"
          >
            + 添加
          </button>
        </div>
      </div>

      {/* 导入面板 */}
      {showImport && (
        <div className="card p-5 space-y-4">
          <div>
            <h4 className="text-sm font-semibold text-text-primary mb-1">JSON 批量导入</h4>
            <p className="text-xs text-text-secondary">
              粘贴 MCP 服务器配置 JSON（支持数组或单个对象）
            </p>
          </div>

          {/* 示例提示 */}
          <div
            className="rounded-lg p-3 text-xs font-mono overflow-x-auto"
            style={{ background: "#FAF8F5", border: "1px dashed #E8E0D4", color: "#8B7355" }}
          >
            {`[
  {
    "name": "filesystem",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/dir"],
    "description": "文件系统访问"
  },
  {
    "name": "github",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-github"],
    "env": { "GITHUB_TOKEN": "ghp_xxx" }
  }
]`}
          </div>

          <textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder="粘贴 JSON 配置..."
            className="input min-h-[140px] font-mono text-xs"
          />

          {importError && <p className="text-sm text-error">{importError}</p>}

          <div className="flex justify-end gap-2">
            <button
              onClick={() => {
                setShowImport(false);
                setImportText("");
                setImportError("");
              }}
              className="btn btn-secondary"
            >
              取消
            </button>
            <button
              onClick={handleImport}
              disabled={importing || !importText.trim()}
              className="btn disabled:opacity-50"
            >
              {importing ? "导入中..." : `导入配置`}
            </button>
          </div>
        </div>
      )}

      {/* 服务器列表 */}
      {servers.map((server) => (
        <div key={server.id} className="card card-hover p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-3 mb-1">
                <h4 className="text-base font-semibold text-text-primary truncate">
                  {server.name}
                </h4>
                <span
                  className={`badge ${server.enabled ? "bg-success-bg text-success" : "bg-muted text-text-secondary"}`}
                >
                  {server.enabled ? "已启用" : "已禁用"}
                </span>
              </div>
              <p className="text-sm text-text-secondary font-mono mb-2 truncate">
                {server.command} {server.args.join(" ")}
              </p>
              {server.description && (
                <p className="text-sm text-text-tertiary">{server.description}</p>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => setEditing(server)}
                className="btn btn-secondary px-3 py-1.5 text-sm"
              >
                编辑
              </button>
              <button
                onClick={() => remove(server.id)}
                className="btn btn-ghost px-3 py-1.5 text-sm text-error hover:text-error hover:bg-error-bg"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      ))}

      {editing && (
        <McpServerEditor server={editing} onSave={save} onCancel={() => setEditing(null)} />
      )}

      {/* 空状态 */}
      {servers.length === 0 && !editing && !showImport && (
        <div className="text-center py-12 bg-white rounded-xl border border-dashed border-[#E8E0D4]">
          <p className="text-text-secondary mb-2">尚未配置 MCP 服务</p>
          <p className="text-xs text-text-tertiary mb-4">
            通过 JSON 导入或手动添加来连接外部工具服务
          </p>
          <button onClick={() => setShowImport(true)} className="btn btn-secondary text-sm">
            导入配置
          </button>
        </div>
      )}
    </div>
  );
}

function McpServerEditor({
  server,
  onSave,
  onCancel,
}: {
  server: Partial<McpServerConfig>;
  onSave: (server: Partial<McpServerConfig>) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState(server);
  const [argsText, setArgsText] = useState((server.args || []).join(" "));
  const [envText, setEnvText] = useState(
    Object.entries(server.env || {})
      .map(([k, v]) => `${k}=${v}`)
      .join("\n"),
  );

  const handleSave = () => {
    const args = argsText.split(" ").filter(Boolean);
    const env: Record<string, string> = {};
    envText.split("\n").forEach((line) => {
      const [key, ...rest] = line.split("=");
      if (key && rest.length > 0) env[key.trim()] = rest.join("=").trim();
    });

    onSave({ ...form, args, env });
  };

  return (
    <div className="card p-5 space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <input
          type="text"
          placeholder="服务器名称"
          value={form.name || ""}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="input"
        />
        <input
          type="text"
          placeholder="命令 (如 npx, node)"
          value={form.command || ""}
          onChange={(e) => setForm({ ...form, command: e.target.value })}
          className="input"
        />
      </div>
      <input
        type="text"
        placeholder="参数，用空格分隔"
        value={argsText}
        onChange={(e) => setArgsText(e.target.value)}
        className="input"
      />
      <textarea
        placeholder="环境变量 (每行一个 KEY=VALUE)"
        value={envText}
        onChange={(e) => setEnvText(e.target.value)}
        className="input min-h-[80px]"
      />
      <input
        type="text"
        placeholder="描述"
        value={form.description || ""}
        onChange={(e) => setForm({ ...form, description: e.target.value })}
        className="input"
      />
      <label className="flex items-center gap-2 text-sm text-text-secondary">
        <input
          type="checkbox"
          checked={form.enabled !== false}
          onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
          className="w-4 h-4 rounded border-border-strong"
        />
        已启用
      </label>
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="btn btn-secondary">
          取消
        </button>
        <button onClick={handleSave} className="btn">
          保存
        </button>
      </div>
    </div>
  );
}
