"use client";

import { useState } from "react";
import { McpServerConfig } from "../../types/config";

interface McpServerListProps {
  servers: McpServerConfig[];
  onChange: (servers: McpServerConfig[]) => void;
}

export default function McpServerList({ servers, onChange }: McpServerListProps) {
  const [editing, setEditing] = useState<Partial<McpServerConfig> | null>(null);

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

  return (
    <div className="space-y-4">
      {servers.map(server => (
        <div key={server.id} className="card card-hover p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-3 mb-1">
                <h4 className="text-base font-semibold text-text-primary truncate">{server.name}</h4>
                <span className={`badge ${server.enabled ? "bg-success-bg text-success" : "bg-muted text-text-secondary"}`}>
                  {server.enabled ? "Enabled" : "Disabled"}
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
                Edit
              </button>
              <button
                onClick={() => remove(server.id)}
                className="btn btn-ghost px-3 py-1.5 text-sm text-error hover:text-error hover:bg-error-bg"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      ))}

      {editing && (
        <McpServerEditor
          server={editing}
          onSave={save}
          onCancel={() => setEditing(null)}
        />
      )}

      {!editing && (
        <button
          onClick={() => setEditing({ name: "", command: "", args: [], env: {}, enabled: true })}
          className="w-full py-4 border-2 border-dashed border-border rounded-xl text-text-secondary hover:border-border-strong hover:text-text-primary transition-colors"
        >
          + Add MCP Server
        </button>
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
      .join("\n")
  );

  const handleSave = () => {
    const args = argsText.split(" ").filter(Boolean);
    const env: Record<string, string> = {};
    envText.split("\n").forEach(line => {
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
          placeholder="Server name"
          value={form.name || ""}
          onChange={e => setForm({ ...form, name: e.target.value })}
          className="input"
        />
        <input
          type="text"
          placeholder="Command (e.g. npx, node)"
          value={form.command || ""}
          onChange={e => setForm({ ...form, command: e.target.value })}
          className="input"
        />
      </div>
      <input
        type="text"
        placeholder="Arguments separated by space"
        value={argsText}
        onChange={e => setArgsText(e.target.value)}
        className="input"
      />
      <textarea
        placeholder="Environment variables (KEY=VALUE per line)"
        value={envText}
        onChange={e => setEnvText(e.target.value)}
        className="input min-h-[80px]"
      />
      <input
        type="text"
        placeholder="Description"
        value={form.description || ""}
        onChange={e => setForm({ ...form, description: e.target.value })}
        className="input"
      />
      <label className="flex items-center gap-2 text-sm text-text-secondary">
        <input
          type="checkbox"
          checked={form.enabled !== false}
          onChange={e => setForm({ ...form, enabled: e.target.checked })}
          className="w-4 h-4 rounded border-border-strong"
        />
        Enabled
      </label>
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="btn btn-secondary">Cancel</button>
        <button onClick={handleSave} className="btn">Save</button>
      </div>
    </div>
  );
}
