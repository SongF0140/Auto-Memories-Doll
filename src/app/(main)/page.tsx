"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { requestApi } from "@/lib/api-client";

type SearchMode = "all" | "notes" | "conversations" | "images";

interface SearchResult {
  id: string;
  title: string;
  titleZh?: string;
  summary: string;
  summaryZh?: string;
  tags: string[];
  topic: string;
  score?: number;
}

export default function DashboardPage() {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMode, setSearchMode] = useState<SearchMode>("all");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [recentQueries, setRecentQueries] = useState<string[]>([]);

  // 从 localStorage 加载搜索历史
  useEffect(() => {
    try {
      const saved = localStorage.getItem("memory-search-history");
      if (saved) setRecentQueries(JSON.parse(saved).slice(0, 5));
    } catch {}
  }, []);

  // 向量检索
  const handleSearch = useCallback(
    async (query: string) => {
      if (!query.trim()) return;

      setSearching(true);
      setShowResults(true);

      try {
        const res = await requestApi<{ items: SearchResult[]; total: number }>(
          `/api/memory/search?q=${encodeURIComponent(query.trim())}&pageSize=10`
        );
        setResults(res.data.items || []);

        // 保存搜索历史
        const updated = [query.trim(), ...recentQueries.filter((q) => q !== query.trim())].slice(0, 10);
        setRecentQueries(updated);
        try {
          localStorage.setItem("memory-search-history", JSON.stringify(updated));
        } catch {}
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    },
    [recentQueries]
  );

  // 提交搜索
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleSearch(searchQuery);
  };

  // 清除结果
  const clearResults = () => {
    setShowResults(false);
    setResults([]);
  };

  const modes: { id: SearchMode; label: string }[] = [
    { id: "all", label: "全部" },
    { id: "notes", label: "笔记" },
    { id: "conversations", label: "对话" },
    { id: "images", label: "图片" },
  ];

  return (
    <div className="min-h-full flex flex-col pop-dots" style={{ paddingTop: "100px", paddingBottom: "64px" }}>
      {/* 搜索区域 - 居中 */}
      <div className="w-full max-w-[720px] px-6 relative z-10">
        {/* Logo + 标题 */}
        <div className="flex flex-col items-center mb-8">
          <div
            className="w-12 h-12 rounded-xl animate-logo-morph flex items-center justify-center mb-5"
            style={{
              background: "linear-gradient(135deg, #A67C00, #D4B84A)",
              boxShadow: "0 8px 32px rgba(166, 124, 0, 0.25)",
            }}
          >
            <svg width="24" height="24" viewBox="0 0 32 32" fill="none">
              <path d="M6 16L16 6L26 16L16 26Z" fill="white" opacity="0.95" />
            </svg>
          </div>

          <h1
            className="text-[32px] font-extrabold text-center leading-none tracking-tight"
            style={{ color: "#3E3224" }}
          >
            记忆中枢
          </h1>

          <p className="text-sm mt-2 text-center max-w-md" style={{ color: "#8B7355" }}>
            通过向量语义检索，从你的知识库中找到相关记忆
          </p>
        </div>

        {/* 选项栏 */}
        <div className="flex items-center justify-center gap-2 mb-4">
          {modes.map((mode) => (
            <button
              key={mode.id}
              onClick={() => setSearchMode(mode.id)}
              className={`px-4 py-1.5 rounded-full text-[13px] font-semibold transition-all duration-200 cursor-pointer ${
                searchMode === mode.id
                  ? "bg-[#A67C00] text-white shadow-md"
                  : "bg-white/80 text-[#5D4E37] hover:bg-white border border-[#E8E0D4]"
              }`}
              style={searchMode === mode.id ? { boxShadow: "0 4px 12px rgba(166, 124, 0, 0.25)" } : {}}
            >
              {mode.label}
            </button>
          ))}
        </div>

        {/* 搜索框 */}
        <form onSubmit={handleSubmit} className="relative group">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="输入关键词，向量检索相关知识..."
            className="w-full h-14 pl-6 pr-14 rounded-2xl text-base outline-none transition-all duration-200 bg-white"
            style={{
              border: "2px solid #E8E0D4",
              color: "#3E3224",
              boxShadow: "0 4px 16px rgba(44, 36, 22, 0.06)",
            }}
            onFocus={(e) => {
              e.currentTarget.style.borderColor = "#A67C00";
              e.currentTarget.style.boxShadow =
                "0 4px 20px rgba(166, 124, 0, 0.15), 0 0 0 4px rgba(166, 124, 0, 0.08)";
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = "#E8E0D4";
              e.currentTarget.style.boxShadow = "0 4px 16px rgba(44, 36, 22, 0.06)";
            }}
          />
          <button
            type="submit"
            disabled={searching}
            className="absolute right-4 top-1/2 -translate-y-1/2 p-2 rounded-xl transition-all duration-200 hover:bg-[rgba(166,124,0,0.08)] disabled:opacity-50"
            style={{ color: "#A67C00" }}
          >
            {searching ? (
              <svg className="animate-spin" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" opacity="0.3" />
                <path d="M12 2a10 10 0 0 1 10 10" />
              </svg>
            ) : (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <path d="M21 21l-4.35-4.35" />
              </svg>
            )}
          </button>
        </form>

        {/* 搜索提示文字 */}
        <p className="text-xs text-center mt-3" style={{ color: "#A69780" }}>
          支持自然语言查询，如「上周讨论的 React 性能优化方案」
        </p>
      </div>

      {/* 搜索结果区域 */}
      {showResults && (
        <div className="w-full max-w-[720px] mx-auto mt-8 px-6 relative z-10">
          {/* 结果头部 */}
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold" style={{ color: "#5D4E37" }}>
              {searching ? "检索中..." : `找到 ${results.length} 条相关记忆`}
            </h2>
            <button
              onClick={clearResults}
              className="text-xs px-3 py-1 rounded-lg transition-colors hover:bg-[rgba(0,0,0,0.04)]"
              style={{ color: "#8B7355" }}
            >
              清除
            </button>
          </div>

          {/* 结果列表 */}
          {results.length > 0 ? (
            <div className="space-y-3">
              {results.map((item) => (
                <button
                  key={item.id}
                  onClick={() => router.push(`/memory/${item.id}`)}
                  className="w-full text-left p-5 rounded-xl transition-all duration-200 block bg-white border border-[#E8E0D4] hover:border-[#D4B84A] hover:shadow-md group/item"
                >
                  {/* 标题 */}
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <h3
                      className="font-semibold truncate group-hover/item:text-[#A67C00] transition-colors"
                      style={{ color: "#3E3224", fontSize: "15px" }}
                    >
                      {item.titleZh || item.title}
                    </h3>
                    {item.score !== undefined && (
                      <span
                        className="shrink-0 text-xs px-2 py-0.5 rounded-full font-medium"
                        style={{
                          background: "rgba(166, 124, 0, 0.1)",
                          color: "#A67C00",
                        }}
                      >
                        {(item.score * 100).toFixed(0)}%
                      </span>
                    )}
                  </div>

                  {/* 摘要 */}
                  <p
                    className="text-sm line-clamp-2 mb-3"
                    style={{ color: "#8B7355" }}
                  >
                    {item.summaryZh || item.summary}
                  </p>

                  {/* 标签 */}
                  {item.tags && item.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {item.tags.slice(0, 4).map((tag) => (
                        <span
                          key={tag}
                          className="text-[11px] px-2 py-0.5 rounded-full"
                          style={{
                            background: "#F5F0E8",
                            color: "#8B7355",
                            border: "1px solid #E8E0D4",
                          }}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </button>
              ))}
            </div>
          ) : !searching ? (
            /* 无结果 */
            <div className="text-center py-12 bg-white rounded-xl border border-[#E8E0D4]">
              <div className="mb-3">
                <svg
                  width="48"
                  height="48"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#C9BBA8"
                  strokeWidth="1.5"
                  className="mx-auto"
                >
                  <circle cx="11" cy="11" r="8" />
                  <path d="M21 21l-4.35-4.35" />
                  <path d="M8 11h6" />
                </svg>
              </div>
              <p className="text-sm font-medium" style={{ color: "#5D4E37" }}>
                未找到相关记忆
              </p>
              <p className="text-xs mt-1" style={{ color: "#A69780" }}>
                尝试更换关键词或检查拼写
              </p>
            </div>
          ) : null}

          {/* 搜索历史（无结果时显示） */}
          {!searching && results.length === 0 && recentQueries.length > 0 && (
            <div className="mt-8">
              <p className="text-xs font-semibold mb-3 uppercase tracking-wider" style={{ color: "#A69780" }}>
                最近搜索
              </p>
              <div className="flex flex-wrap gap-2">
                {recentQueries.map((q) => (
                  <button
                    key={q}
                    onClick={() => {
                      setSearchQuery(q);
                      handleSearch(q);
                    }}
                    className="px-3 py-1.5 rounded-lg text-[13px] transition-colors bg-white border border-[#E8E0D4] hover:border-[#D4B84A]"
                    style={{ color: "#5D4E37" }}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 底部导航提示 */}
      {!showResults && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-6 z-10">
          <button
            onClick={() => router.push("/memory")}
            className="px-5 py-2.5 rounded-xl text-[13px] font-medium transition-all duration-200 bg-white/90 backdrop-blur-sm border border-[#E8E0D4] hover:border-[#D4B84A] hover:shadow-md"
            style={{ color: "#5D4E37" }}
          >
            浏览全部记忆 →
          </button>
          <button
            onClick={() => router.push("/settings/ai")}
            className="px-5 py-2.5 rounded-xl text-[13px] font-medium transition-all duration-200 btn-pop"
          >
            配置 AI 模型
          </button>
        </div>
      )}
    </div>
  );
}
