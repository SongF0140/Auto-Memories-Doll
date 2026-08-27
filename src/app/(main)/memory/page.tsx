'use client';

import Link from 'next/link';
import React, { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import EmptyState from '@/components/common/EmptyState';
import MemoryLibraryItem from '@/components/memory/MemoryLibraryItem';
import {
  listMemoriesClient,
  searchMemoriesClient,
} from '@/lib/memory-api-client';
import { defaultTopicLabels } from '@/config/topics-data';
import type { MemoryRecord } from '@/types/memory';

const PAGE_SIZE = 12;
const SEARCH_LIMIT = 50;

function LoadingState({ label }: { label: string }) {
  return (
    <div className="flex min-h-[280px] items-center justify-center">
      <div className="text-center">
        <div className="loading-dots mb-4">
          <span />
          <span />
          <span />
        </div>
        <p className="text-sm text-text-secondary">{label}</p>
      </div>
    </div>
  );
}

export default function MemoryLibraryPage() {
  const [memories, setMemories] = useState<MemoryRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [activeTopic, setActiveTopic] = useState('all');
  const [searchInput, setSearchInput] = useState('');
  const [searchMode, setSearchMode] = useState(false);
  const [retrievalMode, setRetrievalMode] = useState<'vector' | 'keyword' | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (searchMode) return;

    let cancelled = false;
    setLoading(true);
    setError('');

    listMemoriesClient(PAGE_SIZE, page, activeTopic === 'all' ? undefined : activeTopic)
      .then((data) => {
        if (cancelled) return;
        setMemories(data.items);
        setTotal(data.total);
      })
      .catch((loadError) => {
        if (cancelled) return;
        setMemories([]);
        setTotal(0);
        setError(loadError instanceof Error ? loadError.message : '记忆列表加载失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeTopic, page, reloadToken, searchMode]);

  const handleSearch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = searchInput.trim();
    if (!query) return;

    setSearchMode(true);
    setLoading(true);
    setError('');
    setRetrievalMode(null);

    try {
      const data = await searchMemoriesClient(query, SEARCH_LIMIT);
      setMemories(data.results);
      setTotal(data.total);
      setRetrievalMode(data.retrievalMode);
    } catch (searchError) {
      setMemories([]);
      setTotal(0);
      setError(searchError instanceof Error ? searchError.message : '记忆搜索失败');
    } finally {
      setLoading(false);
    }
  };

  const clearSearch = () => {
    setSearchInput('');
    setSearchMode(false);
    setRetrievalMode(null);
    setPage(1);
    setReloadToken((token) => token + 1);
  };

  const handleTopicChange = (topic: string) => {
    setActiveTopic(topic);
    setPage(1);
    setSearchInput('');
    setSearchMode(false);
    setRetrievalMode(null);
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const topicOptions = Object.entries(defaultTopicLabels);

  return (
    <div className="min-h-full px-4 py-8 sm:px-6 sm:py-12">
      <div className="mx-auto max-w-6xl">
        <header className="mb-8 flex flex-col gap-5 border-b border-border pb-7 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-text-tertiary">
              Memory Archive
            </p>
            <h1 className="font-mono text-3xl font-bold tracking-tight text-text-primary">记忆检索库</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-text-secondary">
              搜索、筛选和浏览已经通过审计写入的记忆，点击卡片查看完整内容。
            </p>
          </div>
          <Link href="/memory/map" className="btn shrink-0">
            查看知识图谱 →
          </Link>
        </header>

        <section className="card mb-8 p-4 sm:p-5" aria-label="记忆搜索和筛选">
          <form onSubmit={handleSearch} className="flex flex-col gap-3 md:flex-row">
            <label className="sr-only" htmlFor="memory-search-input">
              搜索记忆
            </label>
            <input
              id="memory-search-input"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="搜索标题、摘要、正文或标签..."
              className="input min-h-11 flex-1"
            />
            <button type="submit" className="btn min-h-11 md:px-7" disabled={loading && searchMode}>
              {loading && searchMode ? '搜索中...' : '搜索记忆'}
            </button>
            {searchMode ? (
              <button type="button" className="btn-secondary min-h-11" onClick={clearSearch}>
                返回列表
              </button>
            ) : null}
          </form>

          {!searchMode ? (
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
              <label htmlFor="memory-topic-filter" className="text-sm font-medium text-text-secondary">
                话题筛选
              </label>
              <select
                id="memory-topic-filter"
                value={activeTopic}
                onChange={(event) => handleTopicChange(event.target.value)}
                className="input min-h-10 max-w-xs"
              >
                <option value="all">全部话题</option>
                {topicOptions.map(([topic, label]) => (
                  <option key={topic} value={topic}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </section>

        {retrievalMode === 'keyword' ? (
          <div role="status" className="mb-6 rounded-xl border border-warning-bg bg-warning-bg/70 px-4 py-3 text-sm text-warning">
            当前处于降级模式：Embedding 不可用，搜索已自动切换为关键词匹配。
          </div>
        ) : null}

        {error ? (
          <div role="alert" className="mb-6 flex flex-col gap-3 rounded-xl border border-error/20 bg-error-bg px-4 py-4 text-sm text-error sm:flex-row sm:items-center sm:justify-between">
            <span>{error}</span>
            <button type="button" className="btn-secondary shrink-0" onClick={() => setReloadToken((token) => token + 1)}>
              重试
            </button>
          </div>
        ) : null}

        {loading ? (
          <LoadingState label={searchMode ? '正在搜索记忆...' : '正在加载记忆库...'} />
        ) : memories.length === 0 ? (
          <EmptyState
            title={searchMode ? '没有找到匹配的记忆' : '暂无记忆'}
            description={searchMode ? '尝试更换关键词或检查拼写。' : '先开始一段对话或导入内容，记忆会出现在这里。'}
          />
        ) : (
          <>
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-mono text-lg font-semibold text-text-primary">
                {searchMode ? `搜索结果（${total}）` : `全部记忆（${total}）`}
              </h2>
              {!searchMode ? <span className="text-sm text-text-tertiary">第 {page} / {totalPages} 页</span> : null}
            </div>

            <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
              {memories.map((memory) => (
                <MemoryLibraryItem key={memory.id} memory={memory} />
              ))}
            </div>

            {!searchMode && totalPages > 1 ? (
              <nav className="mt-8 flex items-center justify-center gap-3" aria-label="记忆列表分页">
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={page <= 1}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  上一页
                </button>
                <span className="min-w-20 text-center text-sm text-text-secondary">
                  {page} / {totalPages}
                </span>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={page >= totalPages}
                  onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                >
                  下一页
                </button>
              </nav>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
