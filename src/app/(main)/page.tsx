'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { memoryDetailHref, searchMemoriesClient } from '@/lib/memory-api-client';
import { HeroCanvas } from '@/components/ui/HeroCanvas';

type SearchMode = 'all' | 'notes' | 'conversations' | 'images';

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

type QuickAccessIconName = 'library' | 'settings' | 'profile' | 'audit';

const QuickAccessIcon = ({ name }: { name: QuickAccessIconName }) => {
  const iconProps = {
    width: 21,
    height: 21,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };

  switch (name) {
    case 'library':
      return (
        <svg {...iconProps}>
          <path d="M5 5.25A2.25 2.25 0 0 1 7.25 3H19v16H7.25A2.25 2.25 0 0 0 5 21.25V5.25Z" />
          <path d="M5 5.25V19A2.25 2.25 0 0 0 7.25 21H19" />
          <path d="M8.5 7.5h7M8.5 11h7" />
        </svg>
      );
    case 'settings':
      return (
        <svg {...iconProps}>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
      );
    case 'profile':
      return (
        <svg {...iconProps}>
          <circle cx="12" cy="8" r="3.25" />
          <path d="M5 20c.9-3.25 3.2-5 7-5s6.1 1.75 7 5" />
        </svg>
      );
    case 'audit':
      return (
        <svg {...iconProps}>
          <path d="M7 3.5h7l3 3v14H7z" />
          <path d="M14 3.5v3h3M9.5 11h5M9.5 14.5h5M9.5 18h3" />
        </svg>
      );
  }
};

// Section 标题组件（rl-handbook 风格）
const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  <h2
    className="font-mono font-semibold text-sm uppercase mb-6"
    style={{
      letterSpacing: '0.1em',
      color: 'var(--foreground-subtle)',
    }}
  >
    {children}
  </h2>
);

export default function DashboardPage() {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMode, setSearchMode] = useState<SearchMode>('all');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [recentQueries, setRecentQueries] = useState<string[]>([]);

  // 从 localStorage 加载搜索历史
  useEffect(() => {
    try {
      const saved = localStorage.getItem('memory-search-history');
      if (saved) setRecentQueries(JSON.parse(saved).slice(0, 5));
    } catch {
      // 忽略损坏的本地搜索历史，保证首页仍可正常使用。
    }
  }, []);

  // 向量检索
  const handleSearch = useCallback(
    async (query: string) => {
      if (!query.trim()) return;

      setSearching(true);
      setShowResults(true);

      try {
        const data = await searchMemoriesClient(query, 10);
        setResults(data.results);

        // 保存搜索历史
        const updated = [query.trim(), ...recentQueries.filter((q) => q !== query.trim())].slice(0, 10);
        setRecentQueries(updated);
        try {
          localStorage.setItem('memory-search-history', JSON.stringify(updated));
        } catch {
          // 本地存储不可用时不影响搜索结果展示。
        }
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
    { id: 'all', label: '全部' },
    { id: 'notes', label: '笔记' },
    { id: 'conversations', label: '对话' },
    { id: 'images', label: '图片' },
  ];

  return (
    <main className="landing-page">
      {/* ===== HERO 区域 - 带粒子网络动画 ===== */}
      <section
        className="landing-hero relative overflow-hidden grain-overlay flex items-center justify-center"
        style={{ minHeight: '65vh' }}
      >
        {/* 粒子动画背景 */}
        <div className="landing-hero-visual" aria-hidden="true">
          <HeroCanvas />
        </div>

        {/* Hero 内容 */}
        <div className="relative z-10 w-full max-w-[720px] min-w-0 text-center px-4 sm:px-6">
          {/* Logo */}
          <div className="flex justify-center mb-6">
            <div
              className="w-14 h-14 rounded-xl flex items-center justify-center"
              style={{
                background: 'linear-gradient(135deg, #A67C00, #D4B84A)',
                boxShadow: '0 8px 32px rgba(166, 124, 0, 0.25)',
              }}
            >
              <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
                <path d="M6 16L16 6L26 16L16 26Z" fill="white" opacity="0.95" />
              </svg>
            </div>
          </div>

          {/* 主标题 - Monospace 字体 */}
          <h1
            className="font-mono font-bold leading-none"
            style={{
              fontSize: 'clamp(2rem, 5vw, 3.5rem)',
              letterSpacing: '-0.02em',
              color: 'var(--foreground)',
            }}
          >
            记忆中枢
          </h1>

          {/* 副标题 */}
          <p
            className="font-sans font-light mt-5 mx-auto max-w-[34rem]"
            style={{
              fontSize: '1.15rem',
              lineHeight: 1.6,
              color: 'var(--foreground-subtle)',
            }}
          >
            通过向量语义检索，从你的知识库中找到相关记忆
          </p>

          {/* CTA 按钮 - 弹性动效 */}
          <div className="mt-8">
            <button
              onClick={() => document.getElementById('search-section')?.scrollIntoView({ behavior: 'smooth' })}
              className="cta-btn inline-block font-mono font-semibold text-sm rounded-xl px-7 py-3 min-h-[44px] leading-normal"
              style={{
                letterSpacing: '0.04em',
                background: 'var(--accent)',
                color: '#FFFFFF',
              }}
            >
              开始检索
            </button>
          </div>
        </div>
      </section>

      {/* ===== 搜索区域 ===== */}
      <section id="search-section" className="landing-section landing-section-search py-10 sm:py-20 px-4 sm:px-6">
        <div style={{ maxWidth: 700, margin: '0 auto' }}>
          <SectionTitle>语义检索</SectionTitle>

          {/* 搜索模式选择 */}
          <div className="flex items-center justify-center gap-2 mb-6">
            {modes.map((mode) => (
              <button
                key={mode.id}
                onClick={() => setSearchMode(mode.id)}
                className={`px-4 py-1.5 rounded-full text-[13px] font-semibold transition-all duration-200 cursor-pointer ${
                  searchMode === mode.id
                    ? 'text-white shadow-md'
                    : 'bg-white/80 hover:bg-white border border-[#E8E0D4]'
                }`}
                style={
                  searchMode === mode.id
                    ? { background: 'var(--accent)', color: '#FFFFFF', boxShadow: '0 4px 12px rgba(166, 124, 0, 0.25)' }
                    : { color: 'var(--foreground-dim)' }
                }
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
              className="w-full h-14 pl-6 pr-14 rounded-xl text-base outline-none transition-all duration-200 bg-white"
              style={{
                border: '2px solid var(--card-border)',
                color: 'var(--foreground)',
                boxShadow: 'var(--shadow-card)',
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = 'var(--accent)';
                e.currentTarget.style.boxShadow =
                  '0 4px 20px rgba(166, 124, 0, 0.15), 0 0 0 4px rgba(166, 124, 0, 0.08)';
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = 'var(--card-border)';
                e.currentTarget.style.boxShadow = 'var(--shadow-card)';
              }}
            />
            <button
              type="submit"
              disabled={searching}
              className="absolute right-4 top-1/2 -translate-y-1/2 p-2 rounded-xl transition-all duration-200 hover:bg-[rgba(166,124,0,0.08)] disabled:opacity-50"
              style={{ color: 'var(--accent)' }}
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

          {/* 搜索提示 */}
          <p className="text-xs text-center mt-3" style={{ color: 'var(--muted)' }}>
            支持自然语言查询，如「上周讨论的 React 性能优化方案」
          </p>
        </div>
      </section>

      {/* ===== 搜索结果区域 ===== */}
      {showResults && (
        <section className="py-10 sm:py-16 px-4 sm:px-6">
          <div style={{ maxWidth: 700, margin: '0 auto' }}>
            {/* 结果头部 */}
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold" style={{ color: 'var(--foreground-dim)' }}>
                {searching ? '检索中...' : `找到 ${results.length} 条相关记忆`}
              </h2>
              <button
                onClick={clearResults}
                className="text-xs px-3 py-1 rounded-lg transition-colors hover:bg-[rgba(0,0,0,0.04)]"
                style={{ color: 'var(--foreground-subtle)' }}
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
                    onClick={() => router.push(memoryDetailHref(item.id))}
                    className="w-full text-left p-5 rounded-xl transition-all duration-200 block bg-white border border-[#E8E0D4] hover:border-[#D4B84A] hover:shadow-md group/item"
                  >
                    {/* 标题 */}
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <h3
                        className="font-semibold truncate group-hover/item:text-[#A67C00] transition-colors"
                        style={{ color: 'var(--foreground)', fontSize: '15px' }}
                      >
                        {item.titleZh || item.title}
                      </h3>
                      {item.score !== undefined && (
                        <span
                          className="shrink-0 text-xs px-2 py-0.5 rounded-full font-medium"
                          style={{
                            background: 'rgba(166, 124, 0, 0.1)',
                            color: '#A67C00',
                          }}
                        >
                          {(item.score * 100).toFixed(0)}%
                        </span>
                      )}
                    </div>

                    {/* 摘要 */}
                    <p className="text-sm line-clamp-2 mb-3" style={{ color: 'var(--foreground-subtle)' }}>
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
                              background: 'var(--background-warm)',
                              color: 'var(--foreground-subtle)',
                              border: '1px solid var(--card-border)',
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
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#C9BBA8" strokeWidth="1.5" className="mx-auto">
                    <circle cx="11" cy="11" r="8" />
                    <path d="M21 21l-4.35-4.35" />
                    <path d="M8 11h6" />
                  </svg>
                </div>
                <p className="text-sm font-medium" style={{ color: 'var(--foreground-dim)' }}>
                  未找到相关记忆
                </p>
                <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
                  尝试更换关键词或检查拼写
                </p>
              </div>
            ) : null}

            {/* 搜索历史 */}
            {!searching && results.length === 0 && recentQueries.length > 0 && (
              <div className="mt-8">
                <p className="text-xs font-semibold mb-3 uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
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
                      style={{ color: 'var(--foreground-dim)' }}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* ===== 快捷入口 ===== */}
      {!showResults && (
        <section className="landing-section landing-section-quick-access pt-2 pb-12 sm:pt-4 sm:pb-20 px-4 sm:px-6">
          <div style={{ maxWidth: 700, margin: '0 auto' }}>
            <SectionTitle>快捷入口</SectionTitle>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-8 sm:mt-10">
              {[
                { label: '浏览全部记忆', href: '/memory', icon: 'library' as const },
                { label: '配置 AI 模型', href: '/settings/ai', icon: 'settings' as const },
                { label: '查看用户画像', href: '/profile', icon: 'profile' as const },
                { label: '审计日志', href: '/audit', icon: 'audit' as const },
              ].map((item) => (
                <button
                  key={item.href}
                  onClick={() => router.push(item.href)}
                  className="quick-link p-5 rounded-xl"
                  style={{ color: 'var(--foreground)' }}
                >
                  <span className="quick-link__header">
                    <span className="quick-link__icon">
                      <QuickAccessIcon name={item.icon} />
                    </span>
                    <span className="font-sans font-semibold text-sm">{item.label}</span>
                  </span>
                  <span className="quick-link__hint">点击进入 →</span>
                </button>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ===== Footer ===== */}
      <footer
        className="py-8 px-4 sm:px-6"
        style={{ borderTop: '1px solid var(--card-border)' }}
      >
        <div
          className="flex flex-wrap items-center justify-center gap-10 sm:gap-12 text-sm font-sans"
          style={{ color: 'var(--muted)' }}
        >
          <span>© 2026 Auto-Memories-Doll</span>
          <a
            href="https://github.com/lubludrova/rl-handbook"
            target="_blank"
            rel="noopener noreferrer"
            className="icon-link"
            style={{ lineHeight: 0 }}
            aria-label="设计灵感来源"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
            </svg>
          </a>
        </div>
      </footer>
    </main>
  );
}
