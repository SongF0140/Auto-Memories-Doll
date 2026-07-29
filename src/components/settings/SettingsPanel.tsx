"use client";

import { useState, useEffect } from "react";
import { AiConfig, McpServerConfig, SkillConfig } from "../../types/config";
import AiConfigForm from "./AiConfigForm";
import McpServerList from "./McpServerList";
import SkillList from "./SkillList";

type Tab = "ai" | "mcp" | "skills";

export default function SettingsPanel() {
  const [activeTab, setActiveTab] = useState<Tab>("ai");
  const [aiConfig, setAiConfig] = useState<AiConfig | null>(null);
  const [mcpServers, setMcpServers] = useState<McpServerConfig[]>([]);
  const [skills, setSkills] = useState<SkillConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadAll();
  }, []);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [aiRes, mcpRes, skillRes] = await Promise.all([
        fetch("/api/config/ai"),
        fetch("/api/config/mcp"),
        fetch("/api/config/skills"),
      ]);
      setAiConfig(await aiRes.json());
      setMcpServers(await mcpRes.json());
      setSkills(await skillRes.json());
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

        <div className="flex gap-2 mb-8 border-b border-border pb-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? "border-accent text-accent"
                  : "border-transparent text-text-secondary hover:text-text-primary"
              }`}
            >
              {tab.label}
              <span className="block text-xs font-normal text-text-tertiary mt-0.5">
                {tab.description}
              </span>
            </button>
          ))}
        </div>

        <div className="animate-fade-in">
          {activeTab === "ai" && (
            <div className="card">
              <h3 className="text-lg font-semibold text-text-primary mb-1">AI 配置</h3>
              <p className="text-sm text-text-tertiary mb-6">
                连接到你的首选 AI 提供商。支持 OpenAI、OpenAI 兼容接口和自定义提供商。
              </p>
              <AiConfigForm config={aiConfig} onSave={saveAiConfig} saving={saving} />
            </div>
          )}

          {activeTab === "mcp" && (
            <div>
              <div className="mb-6">
                <h3 className="text-lg font-semibold text-text-primary mb-1">MCP 服务器</h3>
                <p className="text-sm text-text-tertiary">连接外部 MCP 服务器来扩展能力。</p>
              </div>
              <McpServerList servers={mcpServers} onChange={setMcpServers} />
            </div>
          )}

          {activeTab === "skills" && (
            <div>
              <div className="mb-6">
                <h3 className="text-lg font-semibold text-text-primary mb-1">技能</h3>
                <p className="text-sm text-text-tertiary">
                  定义触发式技能，通过自定义提示词改写用户输入。
                </p>
              </div>
              <SkillList skills={skills} onChange={setSkills} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
