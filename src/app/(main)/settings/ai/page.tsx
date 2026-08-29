"use client";

import { useEffect, useState } from "react";
import { AiConfig } from "@/types/config";
import type { ProviderCatalog } from "@/config/provider-loader";
import AiConfigForm from "@/components/settings/AiConfigForm";

type AiConfigResponse = AiConfig & { providerCatalog?: ProviderCatalog };

export default function AiSettingsPage() {
  const [config, setConfig] = useState<AiConfig | null>(null);
  const [providerCatalog, setProviderCatalog] = useState<ProviderCatalog | undefined>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/config/ai")
      .then(async (r) => {
        if (!r.ok) throw new Error(`加载配置失败（${r.status}）`);
        return (await r.json()) as AiConfigResponse;
      })
      .then((data) => {
        const { providerCatalog: catalog, ...safeConfig } = data;
        setProviderCatalog(catalog);
        setConfig(safeConfig);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "加载配置失败");
      });
  }, []);

  const handleSave = async (next: AiConfig) => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/config/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || `保存失败（${res.status}）`);
      }
      setConfig(next);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "保存配置失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 md:p-10 max-w-3xl mx-auto">
      <div className="card p-6">
        <h2 className="text-lg font-semibold text-text-primary mb-1">AI 配置</h2>
        <p className="text-xs text-text-tertiary mb-6">
          提供商、模型分层与 Embedding — 保存到服务端配置，立即生效
        </p>
        {error && (
          <div className="mb-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}
        {!config ? (
          <div className="flex items-center justify-center py-12">
            <div className="loading-dots">
              <span />
              <span />
              <span />
            </div>
          </div>
        ) : (
          <AiConfigForm
            config={config}
            providerCatalog={providerCatalog}
            onSave={handleSave}
            saving={saving}
          />
        )}
      </div>
    </div>
  );
}
