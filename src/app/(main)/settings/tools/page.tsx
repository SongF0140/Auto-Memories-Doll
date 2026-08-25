"use client";

import { useEffect, useState } from "react";
import { ToolWatchSource, ToolType } from "@/types/config";
import ToolSourceList from "@/components/settings/ToolSourceList";

const API_BASE = "/api/config";

type Preset = { name: string; toolType: ToolType; path: string; filePattern: string };

export default function ToolSourcesPage() {
  const [sources, setSources] = useState<ToolWatchSource[]>([]);
  const [presets, setPresets] = useState<Record<string, Preset>>({});

  useEffect(() => {
    fetch(`${API_BASE}/tool-sources`)
      .then((r) => r.json())
      .then((d) => {
        setSources(d.sources || []);
        setPresets(d.presets || {});
      })
      .catch(() => {});
  }, []);

  const handleChange = () => {
    fetch(`${API_BASE}/tool-sources`)
      .then((r) => r.json())
      .then((d) => setSources(d.sources || []))
      .catch(() => {});
  };

  return (
    <div className="p-6 md:p-10 max-w-3xl mx-auto">
      <div className="card p-6">
        <h2 className="text-lg font-semibold text-text-primary mb-1">工具监听</h2>
        <p className="text-xs text-text-tertiary mb-6">配置 IDE/AI 工具的工作目录监听源</p>
        <ToolSourceList sources={sources} presets={presets} onChange={handleChange} />
      </div>
    </div>
  );
}
