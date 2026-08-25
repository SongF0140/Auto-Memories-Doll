"use client";

import { useEffect, useState } from "react";
import { AiConfig } from "@/types/config";
import AiConfigForm from "@/components/settings/AiConfigForm";

const API_BASE = "/api/config";

export default function AiSettingsPage() {
  const [config, setConfig] = useState<AiConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`${API_BASE}/ai`)
      .then((r) => r.json())
      .then(setConfig)
      .catch(() => setError("加载 AI 配置失败"));
  }, []);

  const handleSave = async (updated: AiConfig) => {
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`${API_BASE}/ai`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated),
      });
      if (!res.ok) throw new Error("保存失败");
      const saved = await res.json();
      setConfig(saved.config || saved);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 md:p-10 max-w-3xl mx-auto">
      <div className="card p-6">
        <h2 className="text-lg font-semibold text-text-primary mb-1">AI 模型配置</h2>
        <p className="text-xs text-text-tertiary mb-6">配置旗舰、标准、廉价和嵌入模型的 API 连接</p>
        {error && <p className="text-error text-sm mb-4">{error}</p>}
        {config ? (
          <AiConfigForm config={config} onSave={handleSave} saving={saving} />
        ) : (
          <p className="text-text-tertiary text-sm">加载中…</p>
        )}
      </div>
    </div>
  );
}
