"use client";

import { useState } from "react";
import { MemoryRecord } from "../../types/memory";
import MemoryCard from "./MemoryCard";
import EmptyState from "../common/EmptyState";
import { SpotlightCard } from "../ui/spotlight-card";
import { MagneticButton } from "../ui/magnetic-button";
import { requestApi } from "../../lib/api-client";
import { MemorySearchResponse } from "../../types/api";

export default function MemorySearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MemoryRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [retrievalMode, setRetrievalMode] = useState<MemorySearchResponse["retrievalMode"]>(null);

  const handleSearch = async () => {
    if (!query.trim()) return;

    setLoading(true);
    setSearched(true);
    try {
      const response = await requestApi<MemorySearchResponse>(
        `/api/memory/search?q=${encodeURIComponent(query)}`,
      );
      setResults(response.data.results);
      setRetrievalMode(response.data.retrievalMode);
    } catch {
      setResults([]);
      setRetrievalMode(null);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleSearch();
    }
  };

  return (
    <div className="flex-1 overflow-y-auto px-6 py-8">
      <div className="max-w-5xl mx-auto">
        <div className="mb-8">
          <h2 className="section-title text-gradient">搜索记忆</h2>
          <p className="section-subtitle mt-1">按语义搜索，而不仅是关键词</p>
        </div>

        <SpotlightCard className="p-2 mb-8 max-w-2xl">
          <div className="flex gap-2 items-center">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="你在找什么？"
              className="input border-0 shadow-none bg-transparent flex-1"
            />
            <MagneticButton
              onClick={handleSearch}
              disabled={loading || !query.trim()}
              className="whitespace-nowrap"
            >
              搜索
            </MagneticButton>
          </div>
        </SpotlightCard>

        {loading && (
          <EmptyState title="搜索中" description={`正在搜索与 "${query}" 相关的记忆...`} />
        )}

        {!loading && searched && (
          <>
            {retrievalMode === "keyword" ? (
              <div
                role="status"
                className="mb-6 rounded-xl border border-warning-bg bg-warning-bg/70 px-4 py-3 text-sm text-warning"
              >
                当前处于降级模式：Embedding 不可用，搜索已自动切换为标题、正文和标签关键词匹配。
              </div>
            ) : null}
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-semibold text-text-primary">
                {results.length > 0 ? "搜索结果" : "无匹配"}
              </h3>
              <span className="text-sm text-text-tertiary">{results.length} 条结果</span>
            </div>

            {results.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 stagger-list">
                {results.map((memory) => (
                  <MemoryCard key={memory.id} memory={memory} className="animate-slide-up" />
                ))}
              </div>
            ) : (
              <div className="text-center py-16">
                <p className="text-text-secondary mb-2">未找到关于 "{query}" 的结果</p>
                <p className="text-sm text-text-tertiary">试试换个说法或检查拼写</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
