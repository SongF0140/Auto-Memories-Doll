"use client";

import React, { useState } from "react";
import { AiConfig, AiProvider, ModelSlot, ModelTierConfig, EmbeddingConfig } from "../../types/config";
import type { ProviderCatalog } from "../../config/provider-loader";
import {
  buildProviderOptions,
  buildProviderSelectionPatch,
} from "./ai-config-options";

type ChatSlot = Exclude<ModelSlot, "embedding">;

interface AiConfigFormProps {
  config: AiConfig;
  providerCatalog?: ProviderCatalog;
  onSave: (config: AiConfig) => void;
  saving?: boolean;
}

const tierLabels: Record<ChatSlot, { title: string; desc: string }> = {
  flagship: { title: "旗舰模型", desc: "分流、分析、评估 — 强推理，高精度" },
  standard: { title: "普通模型", desc: "对话、代码生成 — 平衡质量与成本" },
  budget: { title: "廉价模型", desc: "测试生成、摘要、简单提取 — 低成本优先" },
};

const tierFields: { key: keyof ModelTierConfig; label: string; type: string; step?: string; min?: number; max?: number; placeholder: string }[] = [
  { key: "model", label: "模型名", type: "text", placeholder: "gpt-4o" },
  { key: "maxTokens", label: "Max Tokens", type: "number", min: 1, max: 131072, placeholder: "8192" },
  { key: "temperature", label: "Temperature", type: "number", step: "0.1", min: 0, max: 2, placeholder: "0.3" },
  { key: "timeout", label: "Timeout (ms)", type: "number", min: 1000, max: 120000, placeholder: "60000" },
  { key: "maxRetries", label: "Max Retries", type: "number", min: 0, max: 10, placeholder: "3" },
];

const tierDefaults: ModelTierConfig = { model: "", maxTokens: 8192, temperature: 0.3, timeout: 60000, maxRetries: 3 };
const embeddingDefaults: EmbeddingConfig = { model: "", dimensions: 1536, maxConcurrency: 8, queueTimeoutMs: 30000 };

function ensureSlots(config: AiConfig): AiConfig {
  return {
    ...config,
    flagship: config.flagship || { ...tierDefaults },
    standard: config.standard || { ...tierDefaults },
    budget: config.budget || { ...tierDefaults },
    embedding: config.embedding || { ...embeddingDefaults },
  };
}

export default function AiConfigForm({ config, providerCatalog, onSave, saving }: AiConfigFormProps) {
  const [form, setForm] = useState<AiConfig>(() => ensureSlots(config));
  const providers = buildProviderOptions(providerCatalog, form.provider);

  const updateShared = <K extends "provider" | "baseURL" | "apiKey">(
    key: K,
    value: AiConfig[K],
  ) => {
    setForm((prev) => {
      if (key === "provider") {
        return {
          ...prev,
          ...buildProviderSelectionPatch(prev, value as AiProvider, providerCatalog),
        };
      }
      return { ...prev, [key]: value };
    });
  };

  const updateTier = (slot: ChatSlot, key: keyof ModelTierConfig, value: string | number) => {
    setForm((prev) => ({
      ...prev,
      [slot]: { ...(prev[slot] as ModelTierConfig), [key]: value },
    }));
  };

  const updateEmbedding = <K extends keyof EmbeddingConfig>(key: K, value: EmbeddingConfig[K]) => {
    setForm((prev) => ({
      ...prev,
      embedding: { ...prev.embedding, [key]: value },
    }));
  };

  const renderTierSection = (slot: ChatSlot) => {
    const { title, desc } = tierLabels[slot];
    return (
      <div className="border border-border-subtle rounded-lg p-4 space-y-3">
        <div>
          <h4 className="text-sm font-semibold text-text-primary">{title}</h4>
          <p className="text-xs text-text-secondary mt-0.5">{desc}</p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          {tierFields.map((f) => {
            const value = form[slot][f.key];
            const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
              const raw = e.target.value;
              if (f.type === "number") {
                const num = f.key === "temperature" ? parseFloat(raw) : parseInt(raw);
                if (!isNaN(num)) updateTier(slot, f.key, num);
              } else {
                updateTier(slot, f.key, raw);
              }
            };
            return (
              <div key={`${slot}-${f.key}`}>
                <label className="block text-xs font-medium text-text-secondary mb-1">{f.label}</label>
                <input
                  type={f.type}
                  step={f.step}
                  min={f.min}
                  max={f.max}
                  value={value}
                  onChange={onChange}
                  placeholder={f.placeholder}
                  className="input text-sm w-full"
                  required
                />
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave(form);
      }}
      className="space-y-6"
    >
      {/* 共享配置 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-text-primary mb-2">提供商</label>
          <select
            value={form.provider}
            onChange={(e) => updateShared("provider", e.target.value as AiProvider)}
            className="input"
          >
            {providers.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-text-primary mb-2">Base URL</label>
          <input
            type="url"
            value={form.baseURL}
            onChange={(e) => updateShared("baseURL", e.target.value)}
            placeholder="https://api.openai.com/v1"
            className="input"
            required
          />
        </div>
        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-text-primary mb-2">API Key</label>
          <input
            type="password"
            value={form.apiKey}
            onChange={(e) => updateShared("apiKey", e.target.value)}
            placeholder="sk-..."
            className="input"
          />
        </div>
      </div>

      {/* 三层 chat 模型独立配置 */}
      <div className="space-y-4">
        <h3 className="text-base font-semibold text-text-primary">模型分层配置</h3>
        <p className="text-xs text-text-secondary -mt-2">
          不同任务自动路由到对应层级：旗舰做分流分析和评估，普通负责对话和代码，廉价处理测试和摘要。
        </p>
        {renderTierSection("flagship")}
        {renderTierSection("standard")}
        {renderTierSection("budget")}
      </div>

      {/* Embedding 模型配置 */}
      <div className="border border-border-subtle rounded-lg p-4 space-y-3">
        <div>
          <h4 className="text-sm font-semibold text-text-primary">Embedding 模型</h4>
          <p className="text-xs text-text-secondary mt-0.5">向量生成与检索 — 批量处理场景，建议高并发</p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">模型名</label>
            <input
              type="text"
              value={form.embedding.model}
              onChange={(e) => updateEmbedding("model", e.target.value)}
              placeholder="text-embedding-3-small"
              className="input text-sm w-full"
              required
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Dimensions</label>
            <input
              type="number"
              value={form.embedding.dimensions}
              onChange={(e) => updateEmbedding("dimensions", parseInt(e.target.value) || 1536)}
              className="input text-sm w-full"
              required
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Max Concurrency</label>
            <input
              type="number"
              min={1}
              max={50}
              value={form.embedding.maxConcurrency}
              onChange={(e) => updateEmbedding("maxConcurrency", parseInt(e.target.value) || 8)}
              className="input text-sm w-full"
              required
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Queue Timeout (ms)</label>
            <input
              type="number"
              min={1000}
              max={300000}
              value={form.embedding.queueTimeoutMs}
              onChange={(e) => updateEmbedding("queueTimeoutMs", parseInt(e.target.value) || 60000)}
              className="input text-sm w-full"
              required
            />
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <button type="submit" disabled={saving} className="btn">
          {saving ? "保存中..." : "保存 AI 配置"}
        </button>
      </div>
    </form>
  );
}
