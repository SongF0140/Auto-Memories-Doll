"use client";

import { useState, useEffect, useCallback } from "react";
import { MagicCard } from "../ui/magic-card";

type ChangelogEntry = {
  timestamp: string;
  similarity: number;
  addedCount: number;
  addedHighlights: string[];
};

type ProfileData = {
  content: string;
  changelog: ChangelogEntry[];
  degradedMode: boolean;
};

/** 把画像 markdown 解析成区块列表，便于分块展示 */
function parseProfileSections(content: string): { title: string; items: string[] }[] {
  if (!content || content === "暂无用户画像") return [];
  const sections: { title: string; items: string[] }[] = [];
  const lines = content.split("\n");
  let currentSection: { title: string; items: string[] } | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("## ")) {
      if (currentSection) sections.push(currentSection);
      currentSection = { title: trimmed.slice(3), items: [] };
    } else if (trimmed.startsWith("- ") && currentSection) {
      currentSection.items.push(trimmed.slice(2));
    }
  }
  if (currentSection) sections.push(currentSection);
  return sections;
}

const formatTime = (iso: string): string => {
  const d = new Date(iso);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hour = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${month}-${day} ${hour}:${min}`;
};

const SECTION_ICONS: Record<string, string> = {
  技术偏好: "T",
  兴趣领域: "I",
  学习中的领域: "L",
  沟通风格: "C",
  当前项目: "P",
  习惯与偏好: "H",
};

export default function ProfilePanel() {
  const [data, setData] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState("");

  const loadProfile = useCallback(async () => {
    try {
      const res = await fetch("/api/profile");
      if (res.ok) setData(await res.json());
    } catch (e) {
      setError(`加载失败: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const handleAnalyze = async () => {
    setAnalyzing(true);
    setError("");
    try {
      const res = await fetch("/api/profile", { method: "POST" });
      const result = await res.json();
      if (res.ok) {
        setData(result);
      } else {
        setError(result.error || "分析失败");
      }
    } catch (e) {
      setError(`分析失败: ${(e as Error).message}`);
    } finally {
      setAnalyzing(false);
    }
  };

  if (loading) {
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

  const sections = data ? parseProfileSections(data.content) : [];
  const hasProfile = sections.length > 0;

  return (
    <div className="flex-1 overflow-y-auto px-6 py-8">
      <div className="max-w-4xl mx-auto">
        {/* 标题区 */}
        <div className="mb-8 flex items-start justify-between">
          <div>
            <h2 className="section-title text-gradient">用户画像</h2>
            <p className="section-subtitle mt-1">
              系统通过分析对话自动维护你的画像，让回复越来越贴合你的需求
            </p>
          </div>
          <button
            onClick={handleAnalyze}
            disabled={analyzing || data?.degradedMode}
            className="btn h-10 px-5 text-sm shrink-0"
            title={data?.degradedMode ? "AI 降级模式，暂不可用" : "手动触发画像分析"}
          >
            {analyzing ? "分析中..." : "立即分析"}
          </button>
        </div>

        {data?.degradedMode && (
          <div className="mb-4 rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-2.5 text-sm text-yellow-700">
            AI 当前处于降级模式，画像分析暂停。恢复后可点击"立即分析"。
          </div>
        )}

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* 画像内容 */}
        {!hasProfile ? (
          <MagicCard className="p-8 text-center">
            <p className="text-text-tertiary">
              还没有用户画像。开始对话后，系统会自动分析并维护你的画像。
            </p>
          </MagicCard>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
            {sections.map((section) => (
              <MagicCard key={section.title} className="p-5">
                <div className="flex items-center gap-2 mb-3">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent/10 text-accent text-xs font-bold">
                    {SECTION_ICONS[section.title] || "·"}
                  </span>
                  <h3 className="text-sm font-semibold text-text-primary">{section.title}</h3>
                  <span className="ml-auto text-[10px] text-text-tertiary">
                    {section.items.length} 项
                  </span>
                </div>
                <ul className="space-y-1.5">
                  {section.items.map((item, idx) => (
                    <li key={idx} className="text-xs text-text-secondary leading-relaxed flex gap-1.5">
                      <span className="text-accent/50 shrink-0">·</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </MagicCard>
            ))}
          </div>
        )}

        {/* 变更历史 */}
        {data && data.changelog.length > 0 && (
          <MagicCard className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-text-primary">画像演化历史</h3>
              <span className="text-[11px] text-text-tertiary">
                共 {data.changelog.length} 次更新
              </span>
            </div>
            <div className="space-y-3">
              {data.changelog
                .slice()
                .reverse()
                .map((entry, idx) => (
                  <div key={idx} className="flex gap-3 items-start">
                    {/* 时间线节点 */}
                    <div className="flex flex-col items-center shrink-0">
                      <div
                        className={`h-2 w-2 rounded-full ${
                          idx === 0 ? "bg-accent" : "bg-text-tertiary/40"
                        }`}
                      />
                      {idx < data.changelog.length - 1 && (
                        <div className="w-px h-full bg-border mt-1 min-h-[24px]" />
                      )}
                    </div>
                    {/* 内容 */}
                    <div className="flex-1 pb-3">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[11px] text-text-tertiary font-mono">
                          {formatTime(entry.timestamp)}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-text-tertiary">
                          +{entry.addedCount}
                        </span>
                        <span className="text-[10px] text-text-tertiary">
                          相似度 {entry.similarity}
                        </span>
                      </div>
                      {entry.addedHighlights.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {entry.addedHighlights.map((highlight, hidx) => (
                            <span
                              key={hidx}
                              className="text-[10px] px-1.5 py-0.5 rounded bg-accent/5 text-accent/80 border border-accent/10"
                            >
                              {highlight.length > 30
                                ? `${highlight.slice(0, 30)}...`
                                : highlight}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
            </div>
          </MagicCard>
        )}
      </div>
    </div>
  );
}
