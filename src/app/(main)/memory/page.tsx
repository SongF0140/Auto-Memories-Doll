"use client";

import { Suspense, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { MemoryListResponse } from "@/types/api";
import { MemoryRecord } from "@/types/memory";
import { requestApi } from "@/lib/api-client";
import MemoryViewer from "@/components/memory/MemoryViewer";

/* ── 类型定义 ── */
type ViewMode = "library" | "section" | "detail" | "search";
type Category = "all" | "knowledge" | "work" | "project";

interface KnowledgeSection {
  id: string;
  name: string;
  count: number;
  keywords: string[];
  category: Category;
}

/* ── 分类配置 ── */
const categories: { id: Category; label: string; icon: React.ReactNode }[] = [
  {
    id: "knowledge",
    label: "知识归纳",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      </svg>
    ),
  },
  {
    id: "work",
    label: "工作经验",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
        <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
      </svg>
    ),
  },
  {
    id: "project",
    label: "项目沉淀",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
];

/* ── 思维导图节点组件（棕白金风格） ── */
function MindMapNode({ label, x, y, active }: { label: string; x: number; y: number; active?: boolean }) {
  return (
    <div
      className={`absolute px-3 py-2.5 rounded-xl border-2 text-center text-[13px] font-semibold transition-all duration-200 cursor-pointer ${
        active
          ? "bg-white border-[#A67C00] shadow-lg"
          : "bg-white/90 border-[#D4C8B5] hover:bg-white hover:border-[#A67C00] hover:shadow-md"
      }`}
      style={{
        left: `${x}%`,
        top: `${y}%`,
        transform: "translate(-50%, -50%)",
        minWidth: "100px",
        color: active ? "#A67C00" : "#5D4E37",
        animation: active ? undefined : "breathe 2s ease-in-out infinite",
        animationDelay: `${Math.random() * 1000}ms`,
      }}
    >
      {label}
    </div>
  );
}

/* ── 知识板块卡片 ── */
function SectionCard({ section, onClick }: { section: KnowledgeSection; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="card card-hover text-left p-6 group"
    >
      <h3
        className="text-lg font-semibold mb-1 group-hover:text-[#A67C00] transition-colors"
        style={{ color: "#3E3224" }}
      >
        {section.name}
      </h3>
      <p
        className="text-xs mb-3 font-mono"
        style={{ color: "var(--color-text-secondary)", letterSpacing: "0.02em" }}
      >
        {section.count} 条记忆 · {categories.find((c) => c.id === section.category)?.label}
      </p>
      <div className="flex flex-wrap gap-1.5 mt-3">
        {section.keywords.slice(0, 4).map((kw) => (
          <span
            key={kw}
            className="tag text-xs"
          >
            {kw}
          </span>
        ))}
      </div>
    </button>
  );
}

/* ── 主页面 ── */
function MemoryPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialMode = searchParams.get("mode") as ViewMode | null;

  const [viewMode, setViewMode] = useState<ViewMode>(initialMode || "library");
  const [memories, setMemories] = useState<MemoryRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<Category>("all");
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);
  const [selectedMemoryId, setSelectedMemoryId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState(searchParams.get("q") || "");

  useEffect(() => {
    fetchMemories();
  }, []);

  useEffect(() => {
    if (initialMode === "search") setViewMode("search");
  }, [initialMode]);

  const fetchMemories = async () => {
    setLoading(true);
    try {
      const res = await requestApi<MemoryListResponse>(
        "/api/memory?sortBy=updatedAt&sortOrder=desc&pageSize=100"
      );
      setMemories(res.data.items);
      setTotal(res.data.total);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  };

  /* 将记忆聚合为知识板块 */
  const getKnowledgeSections = (): KnowledgeSection[] => {
    const topicMap = new Map<string, { count: number; keywords: Set<string>; category: Category }>();

    memories.forEach((mem) => {
      const topic = mem.topic || "general";
      const existing = topicMap.get(topic) || { count: 0, keywords: new Set<string>(), category: "knowledge" as Category };
      existing.count += 1;
      mem.tags.forEach((t) => existing.keywords.add(t));
      topicMap.set(topic, existing);
    });

    return Array.from(topicMap.entries()).map(([name, data]) => ({
      id: name,
      name: name.charAt(0).toUpperCase() + name.slice(1),
      count: data.count,
      keywords: Array.from(data.keywords).slice(0, 5),
      category: data.category,
    }));
  };

  const sections = getKnowledgeSections();
  const filteredSections =
    selectedCategory === "all"
      ? sections
      : sections.filter((s) => s.category === selectedCategory);

  const filteredMemories =
    selectedCategory === "all"
      ? memories
      : memories.filter((mem) => mem.topic === selectedCategory);

  /* 搜索结果 */
  const searchResults = searchQuery.trim()
    ? memories.filter(
        (m) =>
          (m.titleZh || m.title).toLowerCase().includes(searchQuery.toLowerCase()) ||
          (m.summaryZh || m.summary).toLowerCase().includes(searchQuery.toLowerCase()) ||
          m.tags.some((t) => t.toLowerCase().includes(searchQuery.toLowerCase()))
      )
    : [];

  /* 左侧面板渲染 */
  const renderLeftPanel = () => {
    if (viewMode === "search") {
      return (
        <div className="flex flex-col h-full p-4" style={{ background: "var(--color-bg-secondary)" }}>
          <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--color-text-primary)" }}>
            搜索结果
          </h3>
          <p className="text-xs mb-4" style={{ color: "var(--color-text-tertiary)" }}>
            找到 {searchResults.length} 条匹配
          </p>
          <div className="space-y-2 overflow-y-auto flex-1">
            {searchResults.map((mem) => (
              <button
                key={mem.id}
                onClick={() => setSelectedMemoryId(mem.id)}
                className={`w-full text-left px-3 py-2.5 rounded-[10px] text-[13px] transition-colors duration-150 ${
                  selectedMemoryId === mem.id
                    ? "bg-blue-50 text-blue-700 font-medium"
                    : "hover:bg-gray-100"
                }`}
                style={{
                  color: selectedMemoryId === mem.id ? undefined : "var(--color-text-primary)",
                }}
              >
                <span className="truncate block">{mem.titleZh || mem.title}</span>
              </button>
            ))}
          </div>
        </div>
      );
    }

    if (viewMode === "detail" && selectedMemoryId) {
      return (
        <div className="flex flex-col h-full p-4" style={{ background: "var(--color-bg-secondary)" }}>
          <button
            onClick={() => { setSelectedMemoryId(null); setViewMode("library"); }}
            className="text-sm font-medium mb-4 flex items-center gap-1"
            style={{ color: "var(--color-brand-blue)" }}
          >
            ← 返回列表
          </button>
          <p className="text-xs" style={{ color: "var(--color-text-tertiary)" }}>正在查看详情</p>
        </div>
      );
    }

    if (viewMode === "section" && selectedSectionId) {
      return (
        <div className="flex flex-col h-full" style={{ background: "var(--color-bg-secondary)" }}>
          {/* 思维导图入口 */}
          <div className="p-4">
            <button
              className="w-full p-4 rounded-xl border bg-white text-left transition-all duration-200 hover:shadow-md"
              style={{ borderColor: "var(--color-border-default)" }}
            >
              <div className="flex items-center gap-3 mb-2">
                {/* 镂空科技风节点示意 */}
                <div className="flex gap-1.5">
                  {[0, 1, 2].map((i) => (
                    <div
                      key={i}
                      className="w-6 h-6 rounded-md border-2 animate-breathe"
                      style={{
                        borderColor: "var(--color-brand-blue)",
                        animationDelay: `${i * 300}ms`,
                      }}
                    />
                  ))}
                </div>
                <span className="text-sm font-medium" style={{ color: "var(--color-text-primary)" }}>
                  思维导图
                </span>
              </div>
              <p className="text-xs" style={{ color: "var(--color-text-tertiary)" }}>
                点击展开知识关联网络
              </p>
            </button>
          </div>

          {/* 分类目录 */}
          <div className="px-4 pb-4">
            <p className="text-xs font-medium uppercase tracking-wider mb-2" style={{ color: "var(--color-text-tertiary)" }}>
              分类目录
            </p>
            <div className="space-y-1">
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategory(cat.id)}
                  className={`w-full flex items-center gap-2.5 px-3.5 py-3 rounded-[10px] text-sm transition-colors duration-150 ${
                    selectedCategory === cat.id
                      ? "font-medium"
                      : ""
                  }`}
                  style={
                    selectedCategory === cat.id
                      ? { background: "var(--color-brand-blue-light)", color: "var(--color-brand-blue)" }
                      : { color: "var(--color-text-primary)" }
                  }
                  onMouseEnter={(e) => {
                    if (selectedCategory !== cat.id)
                      e.currentTarget.style.background = "var(--color-bg-tertiary)";
                  }}
                  onMouseLeave={(e) => {
                    if (selectedCategory !== cat.id)
                      e.currentTarget.style.background = "transparent";
                  }}
                >
                  {cat.icon}
                  {cat.label}
                </button>
              ))}
            </div>
          </div>

          {/* 板块内记忆列表 */}
          <div className="flex-1 overflow-y-auto px-4 pb-4 border-t" style={{ borderColor: "var(--color-border-default)" }}>
            <p className="text-xs font-medium my-3" style={{ color: "var(--color-text-tertiary)" }}>
              记忆 ({filteredMemories.length})
            </p>
            <div className="space-y-1.5">
              {filteredMemories.slice(0, 15).map((mem) => (
                <button
                  key={mem.id}
                  onClick={() => setSelectedMemoryId(mem.id)}
                  className="w-full text-left px-3 py-2 rounded-lg text-[12px] truncate transition-colors"
                  style={{ color: "var(--color-text-primary)" }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "var(--color-bg-tertiary)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                  }}
                >
                  {mem.titleZh || mem.title}
                </button>
              ))}
            </div>
          </div>
        </div>
      );
    }

    /* 默认空态 / 图书馆入口 */
    return (
      <div className="flex flex-col items-center justify-center h-full p-6" style={{ background: "var(--color-bg-secondary)" }}>
        {/* 镂空书架图标 */}
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none" className="mb-4 opacity-40">
          <rect x="8" y="6" width="32" height="36" rx="3" stroke="#D1D5DB" strokeWidth="2" />
          <line x1="16" y1="6" x2="16" y2="42" stroke="#D1D5DB" strokeWidth="1.5" />
          <line x1="24" y1="6" x2="24" y2="42" stroke="#D1D5DB" strokeWidth="1.5" />
          <line x1="32" y1="6" x2="32" y2="42" stroke="#D1D5DB" strokeWidth="1.5" />
          <rect x="11" y="14" width="3" height="10" rx="1" stroke="#D1D5DB" strokeWidth="1.5" />
          <rect x="19" y="18" width="3" height="6" rx="1" stroke="#D1D5DB" strokeWidth="1.5" />
          <rect x="27" y="12" width="3" height="12" rx="1" stroke="#D1D5DB" strokeWidth="1.5" />
          <rect x="35" y="20" width="3" height="8" rx="1" stroke="#D1D5DB" strokeWidth="1.5" />
        </svg>
        <p className="text-sm font-medium mb-1" style={{ color: "var(--color-text-secondary)" }}>
          选择一个知识板块
        </p>
        <p className="text-xs text-center max-w-[180px]" style={{ color: "var(--color-text-tertiary)" }}>
          从右侧选择一个板块，开始探索你的记忆
        </p>
      </div>
    );
  };

  /* 右侧内容区渲染 */
  const renderRightContent = () => {
    if (selectedMemoryId) {
      return (
        <div className="animate-fade-in">
          <MemoryViewer
            memoryId={selectedMemoryId}
            onClose={() => setSelectedMemoryId(null)}
            onDeleted={() => { setSelectedMemoryId(null); fetchMemories(); }}
            onUpdated={fetchMemories}
          />
        </div>
      );
    }

    if (viewMode === "search") {
      return (
        <div className="animate-fade-in">
          <div className="mb-8">
            <h2 className="text-2xl font-semibold mb-2" style={{ color: "var(--color-text-primary)" }}>
              搜索结果
            </h2>
            <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
              &ldquo;{searchQuery}&rdquo; — 找到 {searchResults.length} 条记忆
            </p>
          </div>

          {searchResults.length > 0 ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-6">
              {searchResults.map((mem) => (
                <SectionCard
                  key={mem.id}
                  section={{
                    id: mem.id,
                    name: mem.titleZh || mem.title,
                    count: 1,
                    keywords: mem.tags,
                    category: "knowledge",
                  }}
                  onClick={() => setSelectedMemoryId(mem.id)}
                />
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <p className="empty-state-title">未找到匹配结果</p>
              <p className="empty-state-desc">尝试其他关键词或浏览全部记忆</p>
              <button
                onClick={() => { setSearchQuery(""); setViewMode("library"); }}
                className="btn mt-4"
              >
                浏览全部记忆
              </button>
            </div>
          )}
        </div>
      );
    }

    if (viewMode === "section" && selectedSectionId) {
      const section = sections.find((s) => s.id === selectedSectionId);
      return (
        <div className="animate-fade-in">
          <div className="mb-8">
            <h2 className="text-2xl font-semibold mb-2" style={{ color: "var(--color-text-primary)" }}>
              {section?.name || "知识板块"}
            </h2>
            <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
              {filteredMemories.length} 条相关记忆
            </p>
          </div>

          {/* 思维导图展示区 */}
          <div
            className="relative w-full h-[320px] rounded-2xl mb-8 overflow-hidden border"
            style={{
              background: "linear-gradient(180deg, var(--color-bg-secondary) 0%, var(--color-bg) 100%)",
              borderColor: "var(--color-border-default)",
            }}
          >
            {/* 中心节点 */}
            <MindMapNode label={section?.name || "中心"} x={50} y={50} active />

            {/* 周围节点 */}
            {filteredMemories.slice(0, 6).map((mem, i) => {
              const angle = (i * 60) * (Math.PI / 180);
              const radius = 30;
              const x = 50 + radius * Math.cos(angle);
              const y = 50 + radius * Math.sin(angle);
              return (
                <MindMapNode
                  key={mem.id}
                  label={(mem.titleZh || mem.title).slice(0, 8)}
                  x={x}
                  y={y}
                />
              );
            })}

            {/* 连线装饰（SVG） */}
            <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 0 }}>
              {filteredMemories.slice(0, 6).map((_, i) => {
                const angle = (i * 60) * (Math.PI / 180);
                const r = 30;
                return (
                  <line
                    key={i}
                    x1="50%"
                    y1="50%"
                    x2={`${50 + r * Math.cos(angle)}%`}
                    y2={`${50 + r * Math.sin(angle)}%`}
                    stroke="#CBD5E1"
                    strokeWidth="2"
                  />
                );
              })}
            </svg>
          </div>

          {/* 分类知识卡片列表 */}
          <h3 className="text-lg font-semibold mb-4" style={{ color: "var(--color-text-primary)" }}>
            相关记忆
          </h3>
          <div className="space-y-3">
            {filteredMemories.map((mem) => (
              <div
                key={mem.id}
                className="bg-white border rounded-xl p-4 cursor-pointer transition-all duration-200 hover:shadow-md"
                style={{ borderColor: "var(--color-border-default)" }}
                onClick={() => setSelectedMemoryId(mem.id)}
              >
                <h4 className="text-base font-semibold mb-1" style={{ color: "var(--color-text-primary)" }}>
                  {mem.titleZh || mem.title}
                </h4>
                <p className="text-sm line-clamp-2" style={{ color: "var(--color-text-secondary)" }}>
                  {mem.summaryZh || mem.summary}
                </p>
                <div className="flex gap-1.5 mt-2 flex-wrap">
                  {mem.tags.slice(0, 3).map((tag) => (
                    <span key={tag} className="tag">{tag}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    }

    /* 默认：图书馆视图 */
    return (
      <div className="animate-fade-in">
        <div className="mb-8">
          <h2 className="text-2xl font-semibold mb-2" style={{ color: "var(--color-text-primary)" }}>
            知识图书馆
          </h2>
          <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
            已自动归纳 {sections.length} 个知识板块 · 共 {total} 条记忆
          </p>
        </div>

        {sections.length > 0 ? (
          <div
            className="grid gap-6"
            style={{
              gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            }}
          >
            {sections.map((section) => (
              <SectionCard
                key={section.id}
                section={section}
                onClick={() => {
                  setSelectedSectionId(section.id);
                  setViewMode("section");
                }}
              />
            ))}
          </div>
        ) : loading ? (
          <div className="empty-state">
            <div className="loading-dots"><span /><span /><span /></div>
            <p className="empty-state-desc mt-3">正在加载记忆...</p>
          </div>
        ) : (
          <div className="empty-state">
            <p className="empty-state-title">暂无记忆</p>
            <p className="empty-state-desc">开始对话或导入内容来创建你的第一条记忆</p>
            <button onClick={() => router.push("/chat")} className="btn mt-4">
              开始对话 →
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex" style={{ height: "calc(100vh - 56px)" }}>
      {/* 左侧信息面板 */}
      <aside
        className="shrink-0 border-r overflow-y-auto"
        style={{
          width: "20%",
          minWidth: "240px",
          maxWidth: "320px",
          borderColor: "var(--color-border-default)",
        }}
      >
        {renderLeftPanel()}
      </aside>

      {/* 右侧内容区 */}
      <main className="flex-1 overflow-y-auto p-8">
        {renderRightContent()}
      </main>
    </div>
  );
}

/* 用 Suspense 包裹以支持 useSearchParams() */
export default function MemoryPageWrapper() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-[calc(100vh-56px)]"><div className="loading-dots"><span /><span /><span /></div></div>}>
      <MemoryPage />
    </Suspense>
  );
}
