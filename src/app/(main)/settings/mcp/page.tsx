"use client";

import { useEffect, useState } from "react";
import { McpServerConfig } from "@/types/config";
import McpServerList from "@/components/settings/McpServerList";

const API_BASE = "/api/config";

export default function McpSettingsPage() {
  const [servers, setServers] = useState<McpServerConfig[]>([]);

  useEffect(() => {
    fetch(`${API_BASE}/mcp`)
      .then((r) => r.json())
      .then((d) => setServers(d.servers || d))
      .catch(() => {});
  }, []);

  const handleChange = () => {
    fetch(`${API_BASE}/mcp`)
      .then((r) => r.json())
      .then((d) => setServers(d.servers || d))
      .catch(() => {});
  };

  return (
    <div className="p-6 md:p-10 max-w-3xl mx-auto">
      <div className="card p-6">
        <h2 className="text-lg font-semibold text-text-primary mb-1">MCP 服务</h2>
        <p className="text-xs text-text-tertiary mb-6">管理 Model Context Protocol 远端工具服务</p>
        <McpServerList servers={servers} onChange={handleChange} />
      </div>
    </div>
  );
}
