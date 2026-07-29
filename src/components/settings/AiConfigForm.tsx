"use client";

import { useState } from "react";
import { AiConfig, AiProvider } from "../../types/config";

interface AiConfigFormProps {
  config: AiConfig;
  onSave: (config: AiConfig) => void;
  saving?: boolean;
}

const providers: { value: AiProvider; label: string }[] = [
  { value: "openai", label: "OpenAI" },
  { value: "openai-compatible", label: "OpenAI Compatible" },
  { value: "anthropic", label: "Anthropic" },
  { value: "custom", label: "Custom" },
];

export default function AiConfigForm({ config, onSave, saving }: AiConfigFormProps) {
  const [form, setForm] = useState<AiConfig>(config);

  const update = <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave(form);
      }}
      className="space-y-6"
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div>
          <label className="block text-sm font-medium text-text-primary mb-2">提供商</label>
          <select
            value={form.provider}
            onChange={(e) => update("provider", e.target.value as AiProvider)}
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
            onChange={(e) => update("baseURL", e.target.value)}
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
            onChange={(e) => update("apiKey", e.target.value)}
            placeholder="sk-..."
            className="input"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-text-primary mb-2">Chat Model</label>
          <input
            type="text"
            value={form.chatModel}
            onChange={(e) => update("chatModel", e.target.value)}
            placeholder="gpt-4o-mini"
            className="input"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-text-primary mb-2">
            Embedding Model
          </label>
          <input
            type="text"
            value={form.embeddingModel}
            onChange={(e) => update("embeddingModel", e.target.value)}
            placeholder="text-embedding-3-small"
            className="input"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-text-primary mb-2">
            Embedding Dimensions
          </label>
          <input
            type="number"
            value={form.embeddingDimensions}
            onChange={(e) => update("embeddingDimensions", parseInt(e.target.value) || 1536)}
            className="input"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-text-primary mb-2">Max Tokens</label>
          <input
            type="number"
            value={form.maxTokens}
            onChange={(e) => update("maxTokens", parseInt(e.target.value) || 2048)}
            className="input"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-text-primary mb-2">Temperature</label>
          <input
            type="number"
            step="0.1"
            min="0"
            max="2"
            value={form.temperature}
            onChange={(e) => update("temperature", parseFloat(e.target.value) || 0.7)}
            className="input"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-text-primary mb-2">Timeout (ms)</label>
          <input
            type="number"
            value={form.timeout}
            onChange={(e) => update("timeout", parseInt(e.target.value) || 30000)}
            className="input"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-text-primary mb-2">Max Retries</label>
          <input
            type="number"
            value={form.maxRetries}
            onChange={(e) => update("maxRetries", parseInt(e.target.value) || 2)}
            className="input"
            required
          />
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
