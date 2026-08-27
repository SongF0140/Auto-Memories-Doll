"use client";

import { useEffect, useState } from "react";
import StorageConfigForm from "@/components/settings/StorageConfigForm";

const API_BASE = "/api/config";

type StorageConfig = {
  notesPath: string;
  databasePath: string;
  updatedAt: string;
};

export default function StorageSettingsPage() {
  const [config, setConfig] = useState<StorageConfig | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    fetch(`${API_BASE}/storage`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(setConfig)
      .catch((e) => setError(e.message));
  };

  useEffect(() => {
    load();
  }, []);

  const handleChanged = () => {
    setError(null);
    load();
  };

  if (error) {
    return (
      <div className="p-6 md:p-10 max-w-3xl mx-auto">
        <div className="card p-6 text-center">
          <p className="text-error text-sm">加载失败: {error}</p>
          <button
            onClick={load}
            className="mt-3 px-4 py-2 rounded-lg bg-accent/15 text-accent text-sm hover:bg-accent/25 transition-all"
          >
            重试
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-10 max-w-3xl mx-auto">
      <div className="card p-6">
        <h2 className="text-lg font-semibold text-text-primary mb-1">存储路径</h2>
        <p className="text-xs text-text-tertiary mb-6">配置记忆库文件的本地存储位置</p>
        {config ? (
          <StorageConfigForm config={config} onChanged={handleChanged} />
        ) : (
          <p className="text-text-tertiary text-sm">加载中…</p>
        )}
      </div>
    </div>
  );
}
