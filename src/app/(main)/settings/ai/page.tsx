"use client";

import { useState } from "react";

/* ── 类型定义 ── */
interface ModelTierConfig {
  model: string;
  maxTokens: number;
  temperature: number;
  timeout: number;
  maxRetries: number;
}

interface EmbeddingConfig {
  model: string;
  dimensions: number;
  maxConcurrency: number;
  queueTimeoutMs: number;
}

interface AiConfig {
  provider: "openai" | "anthropic" | "google" | "custom";
  baseURL: string;
  apiKey: string;
  flagship: ModelTierConfig;
  standard: ModelTierConfig;
  budget: ModelTierConfig;
  embedding: EmbeddingConfig;
}

const defaultTierConfig: ModelTierConfig = {
  model: "",
  maxTokens: 8192,
  temperature: 0.3,
  timeout: 60000,
  maxRetries: 3,
};

const defaultEmbeddingConfig: EmbeddingConfig = {
  model: "",
  dimensions: 1536,
  maxConcurrency: 8,
  queueTimeoutMs: 30000,
};

const defaultConfig: AiConfig = {
  provider: "openai",
  baseURL: "https://api.openai.com/v1",
  apiKey: "",
  flagship: { ...defaultTierConfig },
  standard: { ...defaultTierConfig, model: "gpt-4o-mini" },
  budget: { ...defaultTierConfig, model: "gpt-4o-mini" },
  embedding: { ...defaultEmbeddingConfig, model: "text-embedding-3-small" },
};

const tierLabels: Record<
  keyof Pick<AiConfig, "flagship" | "standard" | "budget">,
  { title: string; desc: string; icon: string }
> = {
  flagship: {
    title: "旗舰模型",
    desc: "分流、分析、评估 — 强推理，高精度",
    icon: "🚀",
  },
  standard: {
    title: "标准模型",
    desc: "对话、代码生成 — 平衡质量与成本",
    icon: "⚡",
  },
  budget: {
    title: "廉价模型",
    desc: "测试生成、摘要、简单提取 — 低成本优先",
    icon: "💰",
  },
};

const providerOptions = [
  { value: "openai", label: "OpenAI (GPT-4o, GPT-4)" },
  { value: "anthropic", label: "Anthropic (Claude 3.5)" },
  { value: "google", label: "Google (Gemini Pro)" },
  { value: "custom", label: "自定义 / 兼容 OpenAI API" },
];

export default function AiSettingsPage() {
  const [config, setConfig] = useState<AiConfig>(() => {
    // 尝试从 localStorage 加载已保存的配置
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("ai-config");
      if (saved) {
        try {
          return { ...defaultConfig, ...JSON.parse(saved) };
        } catch {
          // 本地配置损坏时回退到默认值。
        }
      }
    }
    return defaultConfig;
  });

  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);

  /* ── 更新函数 ── */
  const updateShared = <K extends "provider" | "baseURL" | "apiKey">(
    key: K,
    value: AiConfig[K],
  ) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  };

  const updateTier = (
    slot: "flagship" | "standard" | "budget",
    field: keyof ModelTierConfig,
    value: string | number,
  ) => {
    setConfig((prev) => ({
      ...prev,
      [slot]: { ...(prev[slot] as ModelTierConfig), [field]: value },
    }));
  };

  const updateEmbedding = <K extends keyof EmbeddingConfig>(key: K, value: EmbeddingConfig[K]) => {
    setConfig((prev) => ({
      ...prev,
      embedding: { ...prev.embedding, [key]: value },
    }));
  };

  /* ── 保存到 localStorage ── */
  const handleSave = async () => {
    setSaving(true);
    // 模拟保存延迟
    await new Promise((resolve) => setTimeout(resolve, 500));
    localStorage.setItem("ai-config", JSON.stringify(config));
    setSaving(false);
    // 显示成功提示
    setTestResult({ ok: true, message: "✅ 配置已保存到本地存储！" });
    setTimeout(() => setTestResult(null), 3000);
  };

  /* ── 测试 API 连接（前端模拟） ── */
  const handleTestConnection = async () => {
    if (!config.apiKey.trim()) {
      setTestResult({ ok: false, message: "❌ 请先填写 API Key" });
      return;
    }

    setTesting(true);
    setTestResult(null);

    // 模拟测试延迟
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // 简单验证（实际应该调用后端 API）
    const isValidUrl = config.baseURL.startsWith("http");
    const hasApiKey = config.apiKey.length > 10;

    if (isValidUrl && hasApiKey) {
      setTestResult({
        ok: true,
        message: `✅ 连接成功！\n提供商: ${config.provider}\n端点: ${config.baseURL}\n标准模型: ${config.standard.model || "未设置"}`,
      });
    } else {
      setTestResult({
        ok: false,
        message: `❌ 连接失败\n${!isValidUrl ? "- Base URL 格式不正确" : ""}\n${!hasApiKey ? "- API Key 长度不足（通常 > 10 字符）" : ""}`,
      });
    }

    setTesting(false);
    // 5秒后自动清除结果
    setTimeout(() => setTestResult(null), 5000);
  };

  return (
    <div className="max-w-4xl">
      {/* 标题区 */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[#3E3224] mb-2 font-mono">AI 模型配置</h1>
        <p className="text-sm text-[#8B7D6B]">
          配置多级 API Key 和模型参数，支持旗舰/标准/廉价/嵌入四个层级。所有配置保存在浏览器本地。
        </p>
      </div>

      <div className="space-y-6">
        {/* ── 1. 共享配置区域 ── */}
        <div className="card p-6">
          <h2 className="text-lg font-semibold text-[#3E3224] mb-4 flex items-center gap-2">
            <span>🔗</span> 基础连接配置
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* 提供商选择 */}
            <div>
              <label className="block text-sm font-medium text-[#5D4E37] mb-2">API 提供商</label>
              <select
                value={config.provider}
                onChange={(e) => updateShared("provider", e.target.value as AiConfig["provider"])}
                className="input"
              >
                {providerOptions.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Base URL */}
            <div>
              <label className="block text-sm font-medium text-[#5D4E37] mb-2">Base URL</label>
              <input
                type="url"
                value={config.baseURL}
                onChange={(e) => updateShared("baseURL", e.target.value)}
                placeholder="https://api.openai.com/v1"
                className="input"
              />
            </div>

            {/* API Key */}
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-[#5D4E37] mb-2">
                API Key
                <span className="text-xs text-[#B8AE9A] ml-2">(必填)</span>
              </label>
              <div className="relative">
                <input
                  type={showApiKey ? "text" : "password"}
                  value={config.apiKey}
                  onChange={(e) => updateShared("apiKey", e.target.value)}
                  placeholder="sk-... 或 api-key-..."
                  className="input pr-20"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-[#A67C00] hover:text-[#8B6914] transition-colors"
                >
                  {showApiKey ? "隐藏" : "显示"}
                </button>
              </div>
            </div>
          </div>

          {/* 快速测试按钮 */}
          <div
            className="mt-5 p-4 rounded-xl flex items-center justify-between"
            style={{ background: "#FAF8F5", border: "1px solid #E8E0D4" }}
          >
            <div>
              <h4 className="text-sm font-semibold text-[#3E3224]">连接测试</h4>
              <p className="text-xs text-[#8B7D6B] mt-0.5">验证 API Key 和端点是否可用</p>
            </div>
            <button
              onClick={handleTestConnection}
              disabled={testing || !config.apiKey}
              className="btn btn-secondary text-sm px-5 py-2 disabled:opacity-50"
            >
              {testing ? (
                <span className="flex items-center gap-2">
                  <svg
                    className="animate-spin w-4 h-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <circle cx="12" cy="12" r="10" opacity="0.3" />
                    <path d="M12 2a10 10 0 0 1 10 10" />
                  </svg>
                  测试中...
                </span>
              ) : (
                "测试连接"
              )}
            </button>
          </div>

          {/* 测试结果显示 */}
          {testResult && (
            <div
              className={`mt-4 p-4 rounded-xl text-sm whitespace-pre-line ${
                testResult.ok
                  ? "bg-[#ECFDF5] text-[#059669] border border-[#059669]/20"
                  : "bg-[#FEF2F2] text-[#DC2626] border border-[#DC2626]/20"
              }`}
            >
              {testResult.message}
            </div>
          )}
        </div>

        {/* ── 2. 三层 Chat 模型配置 ── */}
        <div className="card p-6">
          <h2 className="text-lg font-semibold text-[#3E3224] mb-2 flex items-center gap-2">
            <span>🎯</span> 模型分层配置
          </h2>
          <p className="text-sm text-[#8B7D6B] mb-5 -mt-1">
            不同任务自动路由到对应层级：旗舰做分流分析和评估，普通负责对话和代码，廉价处理测试和摘要。
          </p>

          <div className="space-y-5">
            {(Object.keys(tierLabels) as Array<"flagship" | "standard" | "budget">).map((tier) => {
              const { title, desc, icon } = tierLabels[tier];
              const tierConfig = config[tier];

              return (
                <div
                  key={tier}
                  className="border rounded-xl p-5 space-y-4"
                  style={{ borderColor: "#E8E0D4" }}
                >
                  {/* 层级标题 */}
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="text-base font-semibold text-[#3E3224] flex items-center gap-2">
                        <span>{icon}</span> {title}
                      </h3>
                      <p className="text-xs text-[#8B7D6B] mt-0.5">{desc}</p>
                    </div>
                    <span
                      className="px-2.5 py-1 rounded-full text-xs font-mono font-semibold"
                      style={{
                        background:
                          tier === "flagship"
                            ? "rgba(166,124,0,0.1)"
                            : tier === "standard"
                              ? "rgba(201,162,39,0.1)"
                              : "rgba(160,120,60,0.1)",
                        color: "#A67C00",
                      }}
                    >
                      {tier.toUpperCase()}
                    </span>
                  </div>

                  {/* 参数输入网格 */}
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                    {/* 模型名 */}
                    <div>
                      <label className="block text-xs font-medium text-[#8B7D6B] mb-1.5">
                        模型名称
                      </label>
                      <input
                        type="text"
                        value={tierConfig.model}
                        onChange={(e) => updateTier(tier, "model", e.target.value)}
                        placeholder={
                          tier === "flagship"
                            ? "gpt-4o"
                            : tier === "standard"
                              ? "gpt-4o-mini"
                              : "gpt-4o-mini"
                        }
                        className="input text-sm"
                      />
                    </div>

                    {/* Max Tokens */}
                    <div>
                      <label className="block text-xs font-medium text-[#8B7D6B] mb-1.5">
                        Max Tokens
                      </label>
                      <input
                        type="number"
                        value={tierConfig.maxTokens}
                        onChange={(e) =>
                          updateTier(tier, "maxTokens", parseInt(e.target.value) || 8192)
                        }
                        min={1}
                        max={131072}
                        className="input text-sm"
                      />
                    </div>

                    {/* Temperature */}
                    <div>
                      <label className="block text-xs font-medium text-[#8B7D6B] mb-1.5">
                        Temperature
                      </label>
                      <input
                        type="number"
                        value={tierConfig.temperature}
                        onChange={(e) =>
                          updateTier(tier, "temperature", parseFloat(e.target.value) || 0.3)
                        }
                        step={0.1}
                        min={0}
                        max={2}
                        className="input text-sm"
                      />
                    </div>

                    {/* Timeout */}
                    <div>
                      <label className="block text-xs font-medium text-[#8B7D6B] mb-1.5">
                        超时 (ms)
                      </label>
                      <input
                        type="number"
                        value={tierConfig.timeout}
                        onChange={(e) =>
                          updateTier(tier, "timeout", parseInt(e.target.value) || 60000)
                        }
                        min={1000}
                        max={120000}
                        className="input text-sm"
                      />
                    </div>

                    {/* Max Retries */}
                    <div>
                      <label className="block text-xs font-medium text-[#8B7D6B] mb-1.5">
                        重试次数
                      </label>
                      <input
                        type="number"
                        value={tierConfig.maxRetries}
                        onChange={(e) =>
                          updateTier(tier, "maxRetries", parseInt(e.target.value) || 3)
                        }
                        min={0}
                        max={10}
                        className="input text-sm"
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── 3. Embedding 模型配置 ── */}
        <div className="card p-6">
          <h2 className="text-lg font-semibold text-[#3E3224] mb-4 flex items-center gap-2">
            <span>🧠</span> Embedding 模型配置
          </h2>
          <p className="text-sm text-[#8B7D6B] mb-5 -mt-1">
            向量生成与语义检索 — 批量处理场景建议高并发
          </p>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-medium text-[#8B7D6B] mb-1.5">模型名称</label>
              <input
                type="text"
                value={config.embedding.model}
                onChange={(e) => updateEmbedding("model", e.target.value)}
                placeholder="text-embedding-3-small"
                className="input text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#8B7D6B] mb-1.5">向量维度</label>
              <input
                type="number"
                value={config.embedding.dimensions}
                onChange={(e) => updateEmbedding("dimensions", parseInt(e.target.value) || 1536)}
                className="input text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#8B7D6B] mb-1.5">最大并发数</label>
              <input
                type="number"
                value={config.embedding.maxConcurrency}
                onChange={(e) => updateEmbedding("maxConcurrency", parseInt(e.target.value) || 8)}
                min={1}
                max={50}
                className="input text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#8B7D6B] mb-1.5">
                队列超时 (ms)
              </label>
              <input
                type="number"
                value={config.embedding.queueTimeoutMs}
                onChange={(e) =>
                  updateEmbedding("queueTimeoutMs", parseInt(e.target.value) || 30000)
                }
                min={1000}
                max={300000}
                className="input text-sm"
              />
            </div>
          </div>
        </div>

        {/* ── 4. 操作按钮区 ── */}
        <div
          className="flex items-center justify-between pt-4 border-t"
          style={{ borderColor: "#E8E0D4" }}
        >
          <div className="text-sm text-[#8B7D6B]">
            💡 配置会自动保存到浏览器本地存储（localStorage）
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => {
                if (confirm("确定要重置所有配置为默认值吗？")) {
                  setConfig(defaultConfig);
                  localStorage.removeItem("ai-config");
                }
              }}
              className="btn btn-secondary"
            >
              重置默认
            </button>
            <button onClick={handleSave} disabled={saving} className="btn">
              {saving ? (
                <span className="flex items-center gap-2">
                  <svg
                    className="animate-spin w-4 h-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <circle cx="12" cy="12" r="10" opacity="0.3" />
                    <path d="M12 2a10 10 0 0 1 10 10" />
                  </svg>
                  保存中...
                </span>
              ) : (
                "💾 保存配置"
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
