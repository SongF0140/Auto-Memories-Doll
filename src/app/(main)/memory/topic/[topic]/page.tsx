"use client";

/* eslint-disable no-console -- 页面加载失败时保留浏览器端诊断信息。 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import type { MemoryRecord } from "@/types/memory";
import { listMemoriesClient } from "@/lib/memory-api-client";
import Markdown from "@/components/common/Markdown";

export default function KnowledgeDetailPage() {
  const router = useRouter();
  const params = useParams();
  // Next.js App Router 的路由参数已是解码后的值。
  // 不能二次 decodeURIComponent：topic 含裸 % 时会抛 URIError 导致整页崩溃（知识点打不开）。
  const topicId = params.topic as string;
  const [memories, setMemories] = useState<MemoryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // 加载所有记忆数据
  useEffect(() => {
    let cancelled = false;
    async function loadData() {
      setLoading(true);
      setLoadError(null);
      try {
        const data = await listMemoriesClient();
        if (cancelled) return;
        setMemories(data.items);
      } catch (error) {
        console.error("Failed to load memories:", error);
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : "网络请求失败");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadData();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  // 过滤当前 topic 的记忆
  const currentMemories = useMemo(
    () => memories.filter((m) => (m.topic || "general") === topicId),
    [memories, topicId],
  );

  // 当前选中的文章（未选中或已删除时回落到第一篇）
  const selected = useMemo(
    () => currentMemories.find((m) => m.id === selectedId) ?? currentMemories[0] ?? null,
    [currentMemories, selectedId],
  );

  const topicMeta = useMemo(() => {
    if (currentMemories.length === 0) return null;
    const first = currentMemories[0];
    return {
      title: formatTopicName(topicId),
      category: (first as any).category || "knowledge",
      tags: [...new Set(currentMemories.flatMap((m) => m.tags))],
      totalVisits: currentMemories.reduce((sum, m) => sum + (m.accessCount || 0), 0),
      createdAt: new Date(
        Math.min(...currentMemories.map((m) => new Date(m.createdAt).getTime())),
      ).toLocaleDateString("zh-CN"),
      updatedAt: new Date(
        Math.max(...currentMemories.map((m) => new Date(m.updatedAt).getTime())),
      ).toLocaleDateString("zh-CN"),
    };
  }, [currentMemories, topicId]);

  // 删除当前 topic 下所有记忆
  const handleDeleteAll = useCallback(async () => {
    if (
      !confirm(
        `确定要删除"${topicMeta?.title}"下的所有 ${currentMemories.length} 篇文章吗？此操作不可恢复！`,
      )
    ) {
      return;
    }

    setDeleting(true);
    try {
      for (const mem of currentMemories) {
        await fetch(`/api/memory/${mem.id}`, { method: "DELETE" });
      }
      // 删除成功，返回上一级（知识地图）
      router.push("/memory/map");
    } catch (error) {
      console.error("Delete failed:", error);
      alert("删除失败，请重试");
    } finally {
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  }, [currentMemories, router, topicMeta]);

  // 删除单篇文章
  const handleDeleteOne = useCallback(async (id: string) => {
    if (!confirm("确定要删除这篇文章吗？")) return;

    try {
      await fetch(`/api/memory/${id}`, { method: "DELETE" });
      setMemories((prev) => prev.filter((m) => m.id !== id));
      setSelectedId((prev) => (prev === id ? null : prev));
    } catch (error) {
      console.error("Delete failed:", error);
      alert("删除失败");
    }
  }, []);

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center" style={{ background: "#FAF8F5" }}>
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#C9A227] mx-auto mb-4" />
          <p style={{ color: "#5D4E37" }}>加载中...</p>
        </div>
      </div>
    );
  }

  // 加载失败：给出可见错误与重试入口，而不是误报"知识点不存在"
  if (loadError) {
    return (
      <div className="h-screen flex items-center justify-center" style={{ background: "#FAF8F5" }}>
        <div className="text-center" role="alert">
          <h2 className="text-2xl font-bold mb-4" style={{ color: "#3E3224" }}>
            加载失败
          </h2>
          <p style={{ color: "#8B7355" }} className="mb-6">
            {loadError}
          </p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={() => setReloadKey((k) => k + 1)}
              className="px-6 py-3 rounded-lg font-medium transition-all hover:bg-[#C9A227] hover:text-white"
              style={{ background: "#3E3224", color: "#FAF8F5" }}
            >
              重试
            </button>
            <Link
              href="/memory/map"
              className="px-6 py-3 rounded-lg font-medium bg-gray-100 hover:bg-gray-200 transition-colors"
              style={{ color: "#3E3224" }}
            >
              返回知识地图
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!topicMeta || currentMemories.length === 0) {
    return (
      <div className="h-screen flex items-center justify-center" style={{ background: "#FAF8F5" }}>
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-4" style={{ color: "#3E3224" }}>
            知识点不存在
          </h2>
          <p style={{ color: "#8B7355" }} className="mb-6">
            该知识点下没有找到任何文章
          </p>
          <Link
            href="/memory/map"
            className="px-6 py-3 rounded-lg font-medium transition-all hover:bg-[#C9A227] hover:text-white"
            style={{ background: "#3E3224", color: "#FAF8F5" }}
          >
            返回知识地图
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex overflow-hidden" style={{ background: "#FAF8F5" }}>
      {/* 左侧边栏：返回上一级 + 当前知识点下的文章目录 */}
      <aside className="w-72 border-r flex-shrink-0 flex flex-col bg-gradient-to-b from-white to-[#FFFDF9] overflow-y-auto custom-scrollbar">
        {/* 顶部：退出到上一级（知识地图）+ 知识点标题 */}
        <div className="p-4 border-b bg-white/80 backdrop-blur-sm sticky top-0 z-10">
          <Link
            href="/memory/map"
            className="flex items-center gap-2 text-sm font-mono font-semibold mb-3 transition-colors hover:text-[#C9A227]"
            style={{ color: "#3E3224" }}
          >
            ← 退出到上一级
          </Link>
          <h2 className="font-mono font-bold text-base truncate" style={{ color: "#3E3224" }}>
            {topicMeta.title}
          </h2>
          <p className="text-xs mt-1" style={{ color: "#8B7355" }}>
            {currentMemories.length} 篇文章
          </p>
        </div>

        {/* 文章目录：点击切换右侧阅读内容 */}
        <nav className="flex-1 p-3 space-y-1">
          {currentMemories.map((memory, index) => {
            const isActive = memory.id === selected?.id;
            const articleTitle =
              memory.titleZh ||
              memory.summaryZh ||
              memory.title ||
              memory.summary ||
              `文章 ${index + 1}`;

            return (
              <button
                key={memory.id}
                onClick={() => setSelectedId(memory.id)}
                className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-all group ${
                  isActive ? "bg-[#C9A227]/10 font-semibold" : "hover:bg-gray-100"
                }`}
                style={{ color: isActive ? "#3E3224" : "#5D4E37" }}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="truncate" title={articleTitle}>
                    <span
                      className="inline-flex items-center justify-center w-5 h-5 mr-2 rounded-full text-xs flex-shrink-0"
                      style={{ background: "#F5F0E8", color: "#C9A227" }}
                    >
                      {index + 1}
                    </span>
                    {articleTitle}
                  </span>
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteOne(memory.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 px-1 py-0.5 rounded text-xs text-red-500 hover:bg-red-50 transition-all flex-shrink-0 cursor-pointer"
                    title="删除这篇文章"
                  >
                    🗑
                  </span>
                </div>
              </button>
            );
          })}
        </nav>

        {/* 底部统计 */}
        <div className="p-4 border-t bg-white/60">
          <div className="text-xs space-y-1" style={{ color: "#8B7355" }}>
            <div className="flex justify-between">
              <span>文章数</span>
              <span className="font-semibold" style={{ color: "#3E3224" }}>
                {currentMemories.length}
              </span>
            </div>
            <div className="flex justify-between">
              <span>总记忆数</span>
              <span className="font-semibold" style={{ color: "#3E3224" }}>
                {memories.length}
              </span>
            </div>
          </div>
        </div>
      </aside>

      {/* 右侧主内容区：当前选中文章的阅读视图 */}
      <main className="flex-1 overflow-y-auto custom-scrollbar">
        <div className="max-w-4xl mx-auto p-8 md:p-12">
          {/* 面包屑导航 */}
          <nav className="mb-6 text-sm font-mono" style={{ color: "#8B7355" }}>
            <Link href="/" className="hover:text-[#C9A227] transition-colors">
              首页
            </Link>
            <span className="mx-2">/</span>
            <Link href="/memory" className="hover:text-[#C9A227] transition-colors">
              检索库
            </Link>
            <span className="mx-2">/</span>
            <Link href="/memory/map" className="hover:text-[#C9A227] transition-colors">
              {topicMeta.title}
            </Link>
          </nav>

          {selected ? (
            <article>
              {/* 标题区域 */}
              <header className="mb-8 pb-6 border-b-2 border-[#E8DCC8]">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <span
                      className="inline-block px-3 py-1 rounded-full text-xs font-semibold mb-3"
                      style={{
                        background:
                          topicMeta.category === "knowledge"
                            ? "#8B7355"
                            : topicMeta.category === "work"
                              ? "#A0522D"
                              : "#CD853F",
                        color: "#FFFFFF",
                      }}
                    >
                      {
                        {
                          knowledge: "📚 知识归纳",
                          work: "💼 工作经验",
                          project: "🎯 项目沉淀",
                        }[
                          topicMeta.category as keyof {
                            knowledge: string;
                            work: string;
                            project: string;
                          }
                        ]
                      }
                    </span>

                    <h1
                      className="text-2xl md:text-3xl font-bold font-mono tracking-tight mb-2"
                      style={{ color: "#3E3224" }}
                    >
                      {selected.titleZh ||
                        selected.title ||
                        selected.summaryZh ||
                        selected.summary ||
                        "未命名文章"}
                    </h1>

                    <p className="text-sm font-mono" style={{ color: "#8B7355" }}>
                      📅 {new Date(selected.createdAt).toLocaleDateString("zh-CN")} · 👹{" "}
                      {selected.accessCount || 0} 次查看
                    </p>
                  </div>

                  <button
                    onClick={() => handleDeleteOne(selected.id)}
                    className="px-4 py-2 rounded-lg text-sm font-medium bg-red-50 text-red-600 hover:bg-red-100 transition-all flex-shrink-0"
                  >
                    🗑 删除本文
                  </button>
                </div>

                {/* 标签 */}
                {selected.tags.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {selected.tags.map((tag) => (
                      <span
                        key={tag}
                        className="px-3 py-1 rounded-full text-xs bg-[#F5F0E8] text-[#5D4E37] hover:bg-[#E8DCC8] transition-colors cursor-default"
                      >
                        #{tag}
                      </span>
                    ))}
                  </div>
                )}
              </header>

              {/* 正文 */}
              <div
                className="prose prose-base max-w-none leading-relaxed whitespace-pre-wrap break-words"
                style={{ color: "#5D4E37" }}
              >
                <Markdown
                  content={
                    selected.content || selected.summaryZh || selected.summary || "（暂无详细内容）"
                  }
                />
              </div>

              {/* 上下篇切换 */}
              <footer className="mt-12 pt-6 border-t flex items-center justify-between text-sm font-mono">
                {currentMemories.length > 1 ? (
                  <>
                    <button
                      disabled={selected.id === currentMemories[0].id}
                      onClick={() => {
                        const idx = currentMemories.findIndex((m) => m.id === selected.id);
                        if (idx > 0) setSelectedId(currentMemories[idx - 1].id);
                      }}
                      className="px-4 py-2 rounded-lg bg-white border border-[#E8DCC8] hover:border-[#C9A227] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                      style={{ color: "#3E3224" }}
                    >
                      ← 上一篇
                    </button>
                    <span style={{ color: "#A09585" }}>
                      {currentMemories.findIndex((m) => m.id === selected.id) + 1} /{" "}
                      {currentMemories.length}
                    </span>
                    <button
                      disabled={selected.id === currentMemories[currentMemories.length - 1].id}
                      onClick={() => {
                        const idx = currentMemories.findIndex((m) => m.id === selected.id);
                        if (idx < currentMemories.length - 1)
                          setSelectedId(currentMemories[idx + 1].id);
                      }}
                      className="px-4 py-2 rounded-lg bg-white border border-[#E8DCC8] hover:border-[#C9A227] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                      style={{ color: "#3E3224" }}
                    >
                      下一篇 →
                    </button>
                  </>
                ) : (
                  <Link
                    href="/memory/map"
                    className="inline-flex items-center gap-2 px-6 py-3 rounded-lg font-medium transition-all hover:bg-[#C9A227] hover:text-white mx-auto"
                    style={{ background: "#3E3224", color: "#FAF8F5" }}
                  >
                    ← 返回知识地图
                  </Link>
                )}
              </footer>
            </article>
          ) : (
            <div className="text-center py-24">
              <p style={{ color: "#8B7355" }}>从左侧目录选择一篇文章开始阅读</p>
            </div>
          )}
        </div>
      </main>

      {/* 删除确认对话框 */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md mx-4 animate-in zoom-in-95 duration-200">
            <h3 className="text-xl font-bold mb-3" style={{ color: "#3E3224" }}>
              ⚠️ 确认删除
            </h3>
            <p className="text-sm mb-6" style={{ color: "#5D4E37" }}>
              您确定要删除 <strong>&ldquo;{topicMeta.title}&rdquo;</strong> 下的全部{" "}
              <strong>{currentMemories.length}</strong> 篇文章吗？
              <br />
              <br />
              此操作<strong>不可恢复</strong>，请谨慎操作！
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-5 py-2.5 rounded-lg text-sm font-medium bg-gray-100 hover:bg-gray-200 transition-colors"
                style={{ color: "#3E3224" }}
              >
                取消
              </button>
              <button
                onClick={handleDeleteAll}
                disabled={deleting}
                className="px-5 py-2.5 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50"
              >
                {deleting ? "删除中..." : "确认删除"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// 辅助函数：格式化主题名称（与主页保持一致）
function formatTopicName(topic: string): string {
  try {
    const decoded = decodeURIComponent(topic);
    if (decoded !== topic) return decoded;
  } catch {
    // 无法解码时继续使用原始 topic。
  }

  const nameMap: Record<string, string> = {
    general: "通用知识",
    "ai-coding": "AI 编程助手",
    "daily-notes": "日常笔记",
    "work-log": "工作日志",
    "project-summary": "项目总结",
    learning: "学习笔记",
    ideas: "灵感创意",
  };

  if (nameMap[topic]) return nameMap[topic];

  const cleaned = topic.replace(/[-_]/g, " ").replace(/[^a-zA-Z0-9\u4e00-\u9fa5\s]/g, "");

  if (/^[a-zA-Z\s]+$/.test(cleaned)) {
    return `知识主题：${cleaned}`;
  }

  return cleaned.length > 15 ? cleaned.slice(0, 15) + "..." : cleaned || "未命名";
}
