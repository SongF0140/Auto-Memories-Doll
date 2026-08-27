'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import type { MemoryRecord } from '@/types/memory';
import { listMemoriesClient, memoryTopicHref } from '@/lib/memory-api-client';

export default function KnowledgeDetailPage() {
  const router = useRouter();
  const params = useParams();
  const topicId = decodeURIComponent(params.topic as string);
  const [memories, setMemories] = useState<MemoryRecord[]>([]);
  const [allTopics, setAllTopics] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // 加载所有记忆数据
  useEffect(() => {
    async function loadData() {
      try {
        const data = await listMemoriesClient();
        setMemories(data.items);

        // 提取所有唯一的 topic
        const topics = [
          ...new Set(data.items.map((memory) => memory.topic || 'general')),
        ] as string[];
        setAllTopics(topics);
      } catch (error) {
        console.error('Failed to load memories:', error);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  // 过滤当前 topic 的记忆
  const currentMemories = useMemo(
    () => memories.filter((m) => (m.topic || 'general') === topicId),
    [memories, topicId]
  );

  // 当前 topic 的元数据
  const topicMeta = useMemo(() => {
    if (currentMemories.length === 0) return null;
    const first = currentMemories[0];
    return {
      title: formatTopicName(topicId),
      category: (first as any).category || 'knowledge',
      tags: [...new Set(currentMemories.flatMap((m) => m.tags))],
      totalVisits: currentMemories.reduce((sum, m) => sum + (m.accessCount || 0), 0),
      createdAt: new Date(
        Math.min(...currentMemories.map((m) => new Date(m.createdAt).getTime()))
      ).toLocaleDateString('zh-CN'),
      updatedAt: new Date(
        Math.max(...currentMemories.map((m) => new Date(m.updatedAt).getTime()))
      ).toLocaleDateString('zh-CN'),
    };
  }, [currentMemories, topicId]);

  // 删除当前 topic 下所有记忆
  const handleDeleteAll = useCallback(async () => {
    if (!confirm(`确定要删除"${topicMeta?.title}"下的所有 ${currentMemories.length} 条记忆吗？此操作不可恢复！`)) {
      return;
    }

    setDeleting(true);
    try {
      for (const mem of currentMemories) {
        await fetch(`/api/memory/${mem.id}`, { method: 'DELETE' });
      }
      // 删除成功，返回地图页
      router.push('/memory');
    } catch (error) {
      console.error('Delete failed:', error);
      alert('删除失败，请重试');
    } finally {
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  }, [currentMemories, router, topicMeta]);

  // 删除单条记忆
  const handleDeleteOne = useCallback(
    async (id: string) => {
      if (!confirm('确定要删除这条记忆吗？')) return;

      try {
        await fetch(`/api/memory/${id}`, { method: 'DELETE' });
        setMemories((prev) => prev.filter((m) => m.id !== id));
      } catch (error) {
        console.error('Delete failed:', error);
        alert('删除失败');
      }
    },
    []
  );

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center" style={{ background: '#FAF8F5' }}>
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#C9A227] mx-auto mb-4" />
          <p style={{ color: '#5D4E37' }}>加载中...</p>
        </div>
      </div>
    );
  }

  if (!topicMeta || currentMemories.length === 0) {
    return (
      <div className="h-screen flex items-center justify-center" style={{ background: '#FAF8F5' }}>
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-4" style={{ color: '#3E3224' }}>
            知识点不存在
          </h2>
          <p style={{ color: '#8B7355' }} className="mb-6">
            该知识点下没有找到任何记忆内容
          </p>
          <Link
            href="/memory"
            className="px-6 py-3 rounded-lg font-medium transition-all hover:bg-[#C9A227] hover:text-white"
            style={{ background: '#3E3224', color: '#FAF8F5' }}
          >
            返回知识图谱
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex overflow-hidden" style={{ background: '#FAF8F5' }}>
      {/* 左侧边栏 - 知识目录 */}
      <aside className="w-72 border-r flex-shrink-0 flex flex-col bg-gradient-to-b from-white to-[#FFFDF9] overflow-y-auto custom-scrollbar">
        {/* 顶部：返回按钮 + 标题 */}
        <div className="p-4 border-b bg-white/80 backdrop-blur-sm sticky top-0 z-10">
          <Link
            href="/memory"
            className="flex items-center gap-2 text-sm font-mono font-semibold mb-3 transition-colors hover:text-[#C9A227]"
            style={{ color: '#3E3224' }}
          >
            ← 返回地图
          </Link>
          <h2 className="font-mono font-bold text-base truncate" style={{ color: '#3E3224' }}>
            知识体系
          </h2>
          <p className="text-xs mt-1" style={{ color: '#8B7355' }}>
            共 {allTopics.length} 个知识点
          </p>
        </div>

        {/* 目录列表 */}
        <nav className="flex-1 p-3 space-y-1">
          {allTopics.map((topic) => {
            const isActive = topic === topicId;
            const count = memories.filter((m) => (m.topic || 'general') === topic).length;
            const formattedName = formatTopicName(topic);

            return (
              <Link
                key={topic}
                href={memoryTopicHref(topic)}
                className={`block px-3 py-2.5 rounded-lg text-sm transition-all ${
                  isActive
                    ? 'bg-[#C9A227]/10 text-[#3E3224] font-semibold'
                    : 'hover:bg-gray-100 text-[#5D4E37]'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="truncate">{formattedName}</span>
                  <span
                    className={`ml-2 px-1.5 py-0.5 rounded text-xs ${
                      isActive ? 'bg-[#C9A227] text-white' : 'bg-gray-200 text-gray-600'
                    }`}
                  >
                    {count}
                  </span>
                </div>
              </Link>
            );
          })}
        </nav>

        {/* 底部统计 */}
        <div className="p-4 border-t bg-white/60">
          <div className="text-xs space-y-1" style={{ color: '#8B7355' }}>
            <div className="flex justify-between">
              <span>总记忆数</span>
              <span className="font-semibold" style={{ color: '#3E3224' }}>{memories.length}</span>
            </div>
            <div className="flex justify-between">
              <span>知识点数</span>
              <span className="font-semibold" style={{ color: '#3E3224' }}>{allTopics.length}</span>
            </div>
          </div>
        </div>
      </aside>

      {/* 右侧主内容区 */}
      <main className="flex-1 overflow-y-auto custom-scrollbar">
        <div className="max-w-4xl mx-auto p-8 md:p-12">
          {/* 面包屑导航 */}
          <nav className="mb-6 text-sm font-mono" style={{ color: '#8B7355' }}>
            <Link href="/" className="hover:text-[#C9A227] transition-colors">
              首页
            </Link>
            <span className="mx-2">/</span>
            <Link href="/memory" className="hover:text-[#C9A227] transition-colors">
              检索库
            </Link>
            <span className="mx-2">/</span>
            <span style={{ color: '#3E3224' }}>{topicMeta.title}</span>
          </nav>

          {/* 标题区域 */}
          <header className="mb-8 pb-6 border-b-2 border-[#E8DCC8]">
            <div className="flex items-start justify-between gap-4">
              <div>
                {/* 分类标签 */}
                <span
                  className="inline-block px-3 py-1 rounded-full text-xs font-semibold mb-3"
                  style={{
                    background:
                      topicMeta.category === 'knowledge'
                        ? '#8B7355'
                        : topicMeta.category === 'work'
                        ? '#A0522D'
                        : '#CD853F',
                    color: '#FFFFFF',
                  }}
                >
                  {{
                    knowledge: '📚 知识归纳',
                    work: '💼 工作经验',
                    project: '🎯 项目沉淀',
                  }[topicMeta.category as keyof { knowledge: string; work: string; project: string }]}
                </span>

                <h1 className="text-3xl md:text-4xl font-bold font-mono tracking-tight mb-2" style={{ color: '#3E3224' }}>
                  {topicMeta.title}
                </h1>

                <p className="text-base" style={{ color: '#8B7355' }}>
                  包含 {currentMemories.length} 条记忆 · 总计访问 {topicMeta.totalVisits} 次
                </p>
              </div>

              {/* 操作按钮组 */}
              <div className="flex items-center gap-3 flex-shrink-0">
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  disabled={deleting}
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-red-50 text-red-600 hover:bg-red-100 transition-all disabled:opacity-50"
                >
                  {deleting ? (
                    <span className="flex items-center gap-2">
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      删除中...
                    </span>
                  ) : (
                    '🗑 删除全部'
                  )}
                </button>
              </div>
            </div>

            {/* 标签云 */}
            {topicMeta.tags.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {topicMeta.tags.slice(0, 12).map((tag) => (
                  <span
                    key={tag}
                    className="px-3 py-1 rounded-full text-xs bg-[#F5F0E8] text-[#5D4E37] hover:bg-[#E8DCC8] transition-colors cursor-default"
                  >
                    #{tag}
                  </span>
                ))}
                {topicMeta.tags.length > 12 && (
                  <span className="px-3 py-1 rounded-full text-xs bg-gray-100 text-gray-500">
                    +{topicMeta.tags.length - 12} 更多
                  </span>
                )}
              </div>
            )}

            {/* 时间信息 */}
            <div className="mt-4 text-xs font-mono" style={{ color: '#A09585' }}>
              创建于 {topicMeta.createdAt} · 最后更新于 {topicMeta.updatedAt}
            </div>
          </header>

          {/* 记忆列表 */}
          <section className="space-y-6">
            <h2 className="font-mono font-bold text-lg mb-4" style={{ color: '#3E3224' }}>
              📝 详细内容
            </h2>

            {currentMemories.map((memory, index) => (
              <article
                key={memory.id}
                className="group relative p-6 rounded-xl bg-white shadow-sm hover:shadow-md transition-all border border-transparent hover:border-[#E8DCC8]"
              >
                {/* 序号 + 标题 */}
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div className="flex items-center gap-3">
                    <span
                      className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold"
                      style={{
                        background: '#F5F0E8',
                        color: '#C9A227',
                      }}
                    >
                      {index + 1}
                    </span>
                    <h3 className="font-semibold text-base" style={{ color: '#3E3224' }}>
                      {memory.summaryZh || memory.summary || `记忆 #${index + 1}`}
                    </h3>
                  </div>

                  {/* 单条删除按钮 */}
                  <button
                    onClick={() => handleDeleteOne(memory.id)}
                    className="opacity-0 group-hover:opacity-100 px-2 py-1 rounded text-xs text-red-500 hover:bg-red-50 transition-all"
                  >
                    🗑
                  </button>
                </div>

                {/* 完整内容 */}
                <div className="pl-11">
                  <div
                    className="prose prose-sm max-w-none leading-relaxed"
                    style={{ color: '#5D4E37' }}
                  >
                    {memory.content || memory.summaryZh || memory.summary || (
                      <em className="opacity-50">（暂无详细内容）</em>
                    )}
                  </div>

                  {/* 元数据 */}
                  <div className="mt-4 pt-3 border-t border-dashed border-[#E8DCC8] flex items-center gap-4 text-xs font-mono" style={{ color: '#A09585' }}>
                    <span>📅 {new Date(memory.createdAt).toLocaleDateString('zh-CN')}</span>
                    <span>👁 {memory.accessCount || 0} 次查看</span>
                    {memory.tags.length > 0 && (
                      <span className="flex gap-1">
                        {memory.tags.slice(0, 3).map((t) => (
                          <span key={t}>#{t}</span>
                        ))}
                      </span>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </section>

          {/* AI 总结区域 */}
          {currentMemories.length > 1 && (
            <section className="mt-12 p-6 rounded-xl bg-gradient-to-br from-[#FFFEF9] to-[#FFF9ED] border-2 border-[#E8DCC8]">
              <h2 className="font-mono font-bold text-lg mb-4 flex items-center gap-2" style={{ color: '#3E3224' }}>
                <span>✨</span> AI 知识总结
              </h2>
              <div className="prose prose-sm max-w-none" style={{ color: '#5D4E37' }}>
                <p className="leading-relaxed">
                  本知识点共收录 <strong>{currentMemories.length}</strong> 条相关记忆，
                  覆盖了 <strong>{topicMeta.tags.length}</strong> 个核心标签。
                  这些内容主要围绕 <strong>{topicMeta.title}</strong> 展开，
                  是您在
                  {{
                    knowledge: '学习成长',
                    work: '工作实践',
                    project: '项目开发',
                  }[topicMeta.category as keyof { knowledge: string; work: string; project: string }]}过程中的重要积累。
                </p>
                <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
                  <div className="p-3 rounded-lg bg-white/60">
                    <div className="font-semibold mb-1" style={{ color: '#C9A227' }}>
                      📊 数据概览
                    </div>
                    <ul className="space-y-1 text-xs" style={{ color: '#8B7355' }}>
                      <li>• 总计 {topicMeta.totalVisits} 次回顾</li>
                      <li>• 首次记录于 {topicMeta.createdAt}</li>
                      <li>• 最近更新于 {topicMeta.updatedAt}</li>
                    </ul>
                  </div>
                  <div className="p-3 rounded-lg bg-white/60">
                    <div className="font-semibold mb-1" style={{ color: '#C9A227' }}>
                      🏷️ 核心标签
                    </div>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {topicMeta.tags.slice(0, 6).map((tag) => (
                        <span key={tag} className="px-2 py-0.5 rounded text-xs bg-[#C9A227]/10 text-[#8B7355]">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* 底部操作栏 */}
          <footer className="mt-12 pt-6 border-t text-center">
            <Link
              href="/memory"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-lg font-medium transition-all hover:bg-[#C9A227] hover:text-white"
              style={{ background: '#3E3224', color: '#FAF8F5' }}
            >
              ← 返回知识图谱
            </Link>
          </footer>
        </div>
      </main>

      {/* 删除确认对话框 */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md mx-4 animate-in zoom-in-95 duration-200">
            <h3 className="text-xl font-bold mb-3" style={{ color: '#3E3224' }}>
              ⚠️ 确认删除
            </h3>
            <p className="text-sm mb-6" style={{ color: '#5D4E37' }}>
              您确定要删除 <strong>&ldquo;{topicMeta.title}&rdquo;</strong> 下的全部{' '}
              <strong>{currentMemories.length}</strong> 条记忆吗？
              <br />
              <br />
              此操作<strong>不可恢复</strong>，请谨慎操作！
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-5 py-2.5 rounded-lg text-sm font-medium bg-gray-100 hover:bg-gray-200 transition-colors"
                style={{ color: '#3E3224' }}
              >
                取消
              </button>
              <button
                onClick={handleDeleteAll}
                disabled={deleting}
                className="px-5 py-2.5 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50"
              >
                {deleting ? '删除中...' : '确认删除'}
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
    general: '通用知识',
    'ai-coding': 'AI 编程助手',
    'daily-notes': '日常笔记',
    'work-log': '工作日志',
    'project-summary': '项目总结',
    learning: '学习笔记',
    ideas: '灵感创意',
  };

  if (nameMap[topic]) return nameMap[topic];

  const cleaned = topic.replace(/[-_]/g, ' ').replace(/[^a-zA-Z0-9\u4e00-\u9fa5\s]/g, '');

  if (/^[a-zA-Z\s]+$/.test(cleaned)) {
    return cleaned
      .split(' ')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  return cleaned.length > 15 ? cleaned.slice(0, 15) + '...' : cleaned || '未命名';
}
