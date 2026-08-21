"use client";

import { useState, useEffect } from "react";
import { AiConfig, McpServerConfig, SkillConfig } from "../../types/config";
import type { ProviderCatalog } from "../../config/provider-loader";
import AiConfigForm from "./AiConfigForm";
import McpServerList from "./McpServerList";
import SkillList from "./SkillList";
import StorageConfigForm from "./StorageConfigForm";
import ToolSourceList from "./ToolSourceList";
import { MagicCard } from "../ui/magic-card";
import { ToolWatchSource, ToolType } from "../../types/config";

type Tab = "ai" | "mcp" | "skills" | "storage" | "tool-sources";

type StorageConfig = {
  notesPath: string;
  databasePath: string;
  updatedAt: string;
};

type ToolPresets = Record<string, { name: string; toolType: ToolType; path: string; filePattern: string }>;
type AiConfigResponse = AiConfig & { providerCatalog?: ProviderCatalog };

export default function SettingsPanel() {
  const [activeTab, setActiveTab] = useState<Tab>("ai");
  const [aiConfig, setAiConfig] = useState<AiConfig | null>(null);
  const [providerCatalog, setProviderCatalog] = useState<ProviderCatalog | undefined>();
  const [mcpServers, setMcpServers] = useState<McpServerConfig[]>([]);
  const [skills, setSkills] = useState<SkillConfig[]>([]);
  const [storageConfig, setStorageConfig] = useState<StorageConfig | null>(null);
  const [toolSources, setToolSources] = useState<ToolWatchSource[]>([]);
  const [toolPresets, setToolPresets] = useState<ToolPresets>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadAll();
  }, []);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [aiRes, mcpRes, skillRes, storageRes, toolRes] = await Promise.all([
        fetch("/api/config/ai"),
        fetch("/api/config/mcp"),
        fetch("/api/config/skills"),
        fetch("/api/config/storage"),
        fetch("/api/config/tool-sources"),
      ]);
      const aiData = (await aiRes.json()) as AiConfigResponse;
      setProviderCatalog(aiData.providerCatalog);
      const { providerCatalog: _providerCatalog, ...safeAiConfig } = aiData;
      setAiConfig(safeAiConfig);
      setMcpServers(await mcpRes.json());
      setSkills(await skillRes.json());
      setStorageConfig(await storageRes.json());
      const toolData = await toolRes.json();
      setToolSources(toolData.sources || []);
      setToolPresets(toolData.presets || {});
    } catch (error) {
      console.error("Failed to load settings:", error);
    } finally {
      setLoading(false);
    }
  };

  const saveAiConfig = async (config: AiConfig) => {
    setSaving(true);
    try {
      const response = await fetch("/api/config/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      if (response.ok) {
        setAiConfig(config);
      }
    } finally {
      setSaving(false);
    }
  };

  const tabs: { id: Tab; label: string; description: string }[] = [
    { id: "ai", label: "AI 配置", description: "API 密钥与模型" },
    { id: "storage", label: "存储路径", description: "笔记与数据库" },
    { id: "tool-sources", label: "工具采集", description: "Cursor/Codex 等" },
    { id: "mcp", label: "MCP 服务器", description: "外部工具服务" },
    { id: "skills", label: "技能", description: "触发式提示词" },
  ];

  if (loading || !aiConfig) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="loading-dots">
          <span />
          <span />
          <span />
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-6 py-8">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h2 className="section-title text-gradient">设置</h2>
          <p className="section-subtitle mt-1">配置 AI 提供商、MCP 服务器和技能</p>
        </div>

        <div className="flex gap-2 mb-8 p-1.5 rounded-2xl bg-muted/50 border border-border backdrop-blur-sm w-fit">
          {tabs.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`relative px-5 py-2.5 rounded-xl text-left transition-all duration-300 ${
                  active
                    ? "bg-surface shadow-sm border border-border-strong"
                    : "bg-transparent border border-transparent hover:bg-surface/60 hover:border-border"
                }`}
              >
                {active && (
                  <span className="absolute inset-0 rounded-xl bg-gradient-to-br from-accent/5 to-[#b88735]/5 pointer-events-none" />
                )}
                <span
                  className={`relative z-10 block text-sm font-semibold ${
                    active ? "text-accent" : "text-text-secondary hover:text-text-primary"
                  }`}
                >
                  {tab.label}
                </span>
                <span className="relative z-10 block text-[11px] text-text-tertiary mt-0.5">
                  {tab.description}
                </span>
              </button>
            );
          })}
        </div>

        <div className="animate-fade-in">
          {activeTab === "ai" && (
            <MagicCard className="p-6">
              <h3 className="text-lg font-semibold text-text-primary mb-1">AI 配置</h3>
              <p className="text-sm text-text-tertiary mb-6">
                连接到你的首选 AI 提供商。支持 OpenAI、OpenAI 兼容接口和自定义提供商。
              </p>
              <AiConfigForm
                config={aiConfig}
                providerCatalog={providerCatalog}
                onSave={saveAiConfig}
                saving={saving}
              />
            </MagicCard>
          )}

          {activeTab === "storage" && storageConfig && (
            <MagicCard className="p-6">
              <h3 className="text-lg font-semibold text-text-primary mb-1">存储路径</h3>
              <p className="text-sm text-text-tertiary mb-6">
                指定笔记的保存位置。数据库路径固定，笔记可随时迁移到大容量分区，无需重启服务。
              </p>
              <StorageConfigForm
                config={storageConfig}
                onChanged={async () => {
                  // 迁移完成后刷新存储配置
                  const res = await fetch("/api/config/storage");
                  if (res.ok) setStorageConfig(await res.json());
                }}
              />
            </MagicCard>
          )}

          {activeTab === "tool-sources" && (
            <MagicCard className="p-6">
              <div className="mb-6">
                <h3 className="text-lg font-semibold text-text-primary mb-1">工具采集源</h3>
                <p className="text-sm text-text-tertiary">
                  监听本地 AI 工具（Cursor/Codex/Claude Code 等）的工作目录，自动采集对话会话并整理为笔记。
                </p>
              </div>
              <ToolSourceList
                sources={toolSources}
                presets={toolPresets}
                onChange={setToolSources}
              />
            </MagicCard>
          )}

          {activeTab === "mcp" && (
            <MagicCard className="p-6">
              <div className="mb-6">
                <h3 className="text-lg font-semibold text-text-primary mb-1">MCP 服务器</h3>
                <p className="text-sm text-text-tertiary">连接外部 MCP 服务器来扩展能力。</p>
              </div>
              <McpServerList servers={mcpServers} onChange={setMcpServers} />
            </MagicCard>
          )}

          {activeTab === "skills" && (
            <MagicCard className="p-6">
              <div className="mb-6">
                <h3 className="text-lg font-semibold text-text-primary mb-1">技能</h3>
                <p className="text-sm text-text-tertiary">
                  定义触发式技能，通过自定义提示词改写用户输入。
                </p>
              </div>
              <SkillList skills={skills} onChange={setSkills} />
            </MagicCard>
          )}
        </div>
      </div>
    </div>
  );
}
