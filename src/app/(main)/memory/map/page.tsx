'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { MemoryRecord } from '@/types/memory';
import { requestApi } from '@/lib/api-client';
import { HeroCanvas } from '@/components/ui/HeroCanvas';

/* ════════════════════════════════════════════════════════════
   知识图谱详情页 - rl-handbook 风格
   动态粒子网络背景 + 无规律分布节点 + 内容查看/删除
   ════════════════════════════════════════════════════════════ */

/* ── 常量 ── */
const VIEW_W = 1400;
const VIEW_H = 900;
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 6;

/* ── 节点类型 ── */
interface MapNode {
  id: string;
  label: string;
  x: number;
  y: number;
  status: 'active' | 'normal' | 'small';
  keywords: string[];
  memoryId?: string;
}

/* ── AI 命名映射 ── */
const topicNameMap: Record<string, string> = {
  "general": "通用知识",
  "daily-notes": "日常笔记",
  "ai-coding": "AI 编程助手",
  "learning": "学习记录",
  "work-log": "工作日志",
  "meeting": "会议纪要",
  "project": "项目管理",
  "idea": "灵感创意",
};

function getFriendlyName(topic: string): string {
  if (topicNameMap[topic]) return topicNameMap[topic];
  const decoded = decodeURIComponent(topic);
  if (decoded !== topic && decoded.match(/^[\u4e00-\u9fa5]/)) return decoded;

  const cleaned = decoded.replace(/[-_]/g, " ").replace(/[^a-zA-Z\u4e00-\u9fa5\s]/g, "").trim();
  if (cleaned.length > 10) return cleaned.slice(0, 10);
  if (cleaned.length > 0) return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);

  let hash = 0;
  for (let i = 0; i < topic.length; i++) hash = ((hash << 5) - hash + topic.charCodeAt(i)) | 0;
  const names = ["知识集锦", "经验总结", "项目档案", "学习笔记", "工作记录", "灵感收集"];
  return names[Math.abs(hash) % names.length];
}

/* ── 将记忆数据转换为地图节点（无规律分布） ── */
function buildMapNodes(memories: MemoryRecord[]): { nodes: MapNode[]; edges: { from: string; to: string }[] } {
  function seededRandom(seed: number) {
    const x = Math.sin(seed) * 10000;
    return x - Math.floor(x);
  }

  const nodes: MapNode[] = memories.map((mem, index) => {
    const seed1 = index * 137 + mem.id.charCodeAt(0) * 31;
    const seed2 = index * 97 + mem.id.length * 17;

    const margin = 120;
    const x = margin + seededRandom(seed1) * (VIEW_W - margin * 2);
    const y = margin + seededRandom(seed2) * (VIEW_H - margin * 2);

    const status: MapNode['status'] =
      mem.accessCount > 5 ? 'active' : mem.accessCount > 2 ? 'normal' : 'small';

    return {
      id: mem.id,
      label: getFriendlyName(mem.titleZh || mem.title || mem.topic || `记忆${index + 1}`),
      x,
      y,
      status,
      keywords: mem.tags.slice(0, 5),
      memoryId: mem.id,
    };
  });

  // 基于共同标签创建连接
  const edges: { from: string; to: string }[] = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const commonTags = memories[i].tags.filter((t) => memories[j].tags.includes(t));
      if (commonTags.length > 0) {
        edges.push({ from: nodes[i].id, to: nodes[j].id });
      }
    }
  }

  return { nodes, edges };
}

/* ── 主组件 ── */
function KnowledgeMapPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const svgRef = useRef<SVGSVGElement>(null);

  const topic = searchParams.get('topic') || '';
  const title = searchParams.get('title') || '知识图谱';

  // 视图状态
  const [view, setView] = useState<{ x: number; y: number; k: number }>({ x: 0, y: 0, k: 1 });
  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [lastMouse, setLastMouse] = useState({ x: 0, y: 0 });

  // 数据状态
  const [memories, setMemories] = useState<MemoryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    fetchMemories();
  }, [topic]);

  const fetchMemories = async () => {
    setLoading(true);
    try {
      let url = '/api/memory?sortBy=updatedAt&sortOrder=desc&pageSize=200';
      if (topic && topic !== 'general') {
        url += `&topic=${encodeURIComponent(topic)}`;
      }
      const res = await requestApi<{ items: MemoryRecord[]; total: number }>(url);
      setMemories(res.data.items);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  };

  /* 删除记忆 */
  const handleDelete = async (memoryId: string) => {
    if (!confirm('确定要删除这条记忆吗？此操作不可撤销。')) return;

    setDeleting(memoryId);
    try {
      await requestApi(`/api/memory/${memoryId}`, { method: 'DELETE' });
      setMemories((prev) => prev.filter((m) => m.id !== memoryId));
      setSelected(null);
      setHovered(null);
    } catch (err) {
      console.error('删除失败:', err);
      alert('删除失败，请重试');
    } finally {
      setDeleting(null);
    }
  };

  const { nodes, edges } = useMemo(() => buildMapNodes(memories), [memories]);
  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  // 关联节点高亮（BFS）
  const relatedNodes = useMemo(() => {
    if (!selected && !hovered) return null;
    const focusId = selected || hovered;
    if (!focusId) return null;

    const related = new Set<string>([focusId!]);
    const queue = [focusId!];
    const visited = new Set([focusId!]);

    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const edge of edges) {
        let next: string | null = null;
        if (edge.from === current && !visited.has(edge.to)) next = edge.to;
        else if (edge.to === current && !visited.has(edge.from)) next = edge.from;

        if (next) {
          related.add(next);
          visited.add(next);
          queue.push(next);
        }
      }
    }

    return related;
  }, [selected, hovered, edges]);

  /* ── 视图控制 ── */

  const handleWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    if (!svgRef.current) return;

    const rect = svgRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const factor = e.deltaY > 0 ? 0.92 : 1.08;
    const newK = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, view.k * factor));

    const newX = mx - (mx - view.x) * (newK / view.k);
    const newY = my - (my - view.y) * (newK / view.k);

    setView({ x: newX, y: newY, k: newK });
  };

  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    setDragging(true);
    setLastMouse({ x: e.clientX, y: e.clientY });
    (e.target as SVGElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (dragging) {
      const dx = e.clientX - lastMouse.x;
      const dy = e.clientY - lastMouse.y;
      setView((prev) => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
      setLastMouse({ x: e.clientX, y: e.clientY });
    }
  };

  const handlePointerUp = () => setDragging(false);

  const resetView = () => {
    setView({ x: 0, y: 0, k: 1 });
    setSelected(null);
    setHovered(null);
  };

  const zoomIn = () => setView((prev) => ({ ...prev, k: Math.min(MAX_ZOOM, prev.k * 1.3) }));
  const zoomOut = () => setView((prev) => ({ ...prev, k: Math.max(MIN_ZOOM, prev.k * 0.77) }));

  /* ── 渲染 ── */

  const transform = `translate(${view.x}, ${view.y}) scale(${view.k})`;

  if (loading) {
    return (
      <div className="relative w-full h-[calc(100vh-56px)] overflow-hidden">
        {/* 动态粒子背景 */}
        <HeroCanvas />

        <div className="absolute inset-0 flex items-center justify-center z-10">
          <div className="text-center" style={{ color: '#3E3224' }}>
            <div className="loading-dots mb-4"><span /><span /><span /></div>
            <p className="text-sm font-mono">正在构建知识图谱...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-[calc(100vh-56px)] overflow-hidden">
      {/* ═══ 动态粒子网络背景（rl-handbook HeroCanvas） ═══ */}
      <HeroCanvas />

      {/* ═══ SVG 知识节点层（叠加在背景上） ═══ */}
      <svg
        ref={svgRef}
        className="absolute inset-0 w-full h-full cursor-grab active:cursor-grabbing z-10"
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        style={{ touchAction: 'none' }}
      >
        <g transform={transform}>
          {/* ── 连线（金色半透明） ── */}
          {edges.map((edge, i) => {
            const fromNode = nodeById.get(edge.from);
            const toNode = nodeById.get(edge.to);
            if (!fromNode || !toNode) return null;

            const isRelated = relatedNodes?.has(edge.from) && relatedNodes?.has(edge.to);
            if (relatedNodes && !isRelated) return null;

            return (
              <line
                key={`edge-${i}`}
                x1={fromNode.x}
                y1={fromNode.y}
                x2={toNode.x}
                y2={toNode.y}
                stroke="#C9A227"
                strokeWidth={isRelated ? 2 : 1}
                opacity={isRelated ? 0.7 : 0.2}
                strokeLinecap="round"
                style={{ transition: 'all 0.3s ease' }}
              />
            );
          })}

          {/* ── 节点（无规律分布） ── */}
          {nodes.map((node) => {
            const isHovered = hovered === node.id;
            const isSelected = selected === node.id;
            const isRelated = relatedNodes?.has(node.id);

            let opacity = 1;
            if (relatedNodes && !isRelated) opacity = 0.18;

            const r = node.status === 'active' ? 32 : node.status === 'normal' ? 26 : 20;
            const scale = isHovered || isSelected ? 1.25 : 1;
            const displayR = r * scale;

            return (
              <g
                key={node.id}
                onClick={() => setSelected(node.id === selected ? null : node.id)}
                onMouseEnter={() => setHovered(node.id)}
                onMouseLeave={() => setHovered(null)}
                className="cursor-pointer"
                style={{ transition: 'all 0.25s ease' }}
              >
                {/* 外发光效果 */}
                {(isHovered || isSelected) && (
                  <>
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={displayR + 15}
                  fill="rgba(166,124,0,0.15)"
                  className="animate-pulse"
                />
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={displayR + 8}
                  fill="rgba(201,162,39,0.2)"
                />
              </>
                )}

                {/* 节点圆（深棕色填充 + 金色描边） */}
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={displayR}
                  fill={isSelected ? '#D4B84A' : isHovered ? '#C9A227' : '#3E3224'}
                  stroke={isSelected ? '#F5F0E8' : '#C9A227'}
                  strokeWidth={isSelected ? 3 : 2}
                  opacity={opacity}
                  style={{
                    filter: isHovered || isSelected
                      ? 'drop-shadow(0 0 12px rgba(201,162,39,0.5))'
                      : 'none',
                    transition: 'all 0.25s ease',
                  }}
                />

                {/* 标签文字 */}
                <text
                  textAnchor="middle"
                  dominantBaseline="central"
                  x={node.x}
                  y={node.y}
                  className="font-mono pointer-events-none select-none"
                  fontSize={node.status === 'active' ? 14 : node.status === 'normal' ? 12 : 10}
                  fontWeight={isSelected || isHovered ? 700 : 600}
                  fill={isSelected || isHovered ? '#3E3224' : '#FAF8F5'}
                  opacity={opacity}
                >
                  {node.label.length > 10 ? node.label.slice(0, 9) + '…' : node.label}
                </text>
              </g>
            );
          })}
        </g>
      </svg>

      {/* ═══ 顶部控制栏 ═══ */}
      <div className="absolute top-4 left-4 right-4 z-20 flex items-center justify-between">
        {/* 返回按钮 */}
        <button
          onClick={() => router.push('/memory')}
          className="flex items-center gap-2 px-4 py-2.5 bg-white/95 backdrop-blur-md rounded-xl shadow-lg border text-sm font-medium transition-all hover:shadow-xl hover:scale-105"
          style={{ borderColor: '#E8DCC8', color: '#A67C00' }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          返回检索库
        </button>

        {/* 标题信息 */}
        <div className="text-center px-6 py-2.5 bg-white/90 backdrop-blur-md rounded-xl shadow-md border" style={{ borderColor: '#E8DCC8' }}>
          <h1 className="text-xl font-bold font-mono" style={{ color: '#3E3224' }}>
            {title}
          </h1>
          <p className="text-xs mt-0.5 font-mono" style={{ color: '#B8AE9A' }}>
            {nodes.length} 个节点 · {edges.length} 条关联 · 拖拽/缩放交互
          </p>
        </div>

        {/* 占位，保持布局平衡 */}
        <div className="w-28" />
      </div>

      {/* ═══ 缩放控制按钮 ═══ */}
      <div className="absolute bottom-6 right-6 z-20 flex flex-col gap-2">
        {[
          { icon: '⊕', action: zoomIn, label: '放大' },
          { icon: '⊖', action: zoomOut, label: '缩小' },
          { icon: '↺', action: resetView, label: '重置视图' },
        ].map(({ icon, action, label }) => (
          <button
            key={label}
            onClick={action}
            className="w-11 h-11 bg-white/95 backdrop-blur-md rounded-xl shadow-lg border flex items-center justify-center hover:bg-[#FAF8F5] hover:scale-105 transition-all text-[#3E3224] text-lg font-bold"
            style={{ borderColor: '#E8DCC8' }}
            title={label}
          >
            {icon}
          </button>
        ))}
      </div>

      {/* ═══ 节点详情面板（内容查看 + 删除） ═══ */}
      {(hovered || selected) && (() => {
        const nodeId = selected || hovered;
        const node = nodeById.get(nodeId!);
        if (!node) return null;

        const mem = memories.find((m) => m.id === node.memoryId);

        return (
          <div
            className="absolute bottom-6 left-6 z-20 bg-white/98 backdrop-blur-md rounded-2xl shadow-2xl border p-6 max-w-lg animate-fade-in"
            style={{
              borderColor: '#E8DCC8',
              animationDuration: '0.3s',
            }}
          >
            {/* 头部：标题 + 操作按钮 */}
            <div className="flex items-start justify-between mb-4">
              <h3 className="text-xl font-bold text-[#3E3224] font-mono pr-4">{node.label}</h3>
              <div className="flex items-center gap-2 shrink-0">
                {/* 删除按钮 */}
                <button
                  onClick={() => mem && handleDelete(mem.id)}
                  disabled={deleting === mem?.id}
                  className="p-2 rounded-lg border transition-all hover:bg-red-50 hover:border-red-300 hover:text-red-600 disabled:opacity-50"
                  style={{ borderColor: '#E8DCC8', color: '#8B7D6B' }}
                  title="删除此记忆"
                >
                  {deleting === mem?.id ? (
                    <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.3"/>
                      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>
                    </svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                  )}
                </button>
                {/* 关闭按钮 */}
                <button
                  onClick={() => { setSelected(null); setHovered(null); }}
                  className="p-2 rounded-lg border transition-all hover:bg-gray-50"
                  style={{ borderColor: '#E8DCC8', color: '#8B7D6B' }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            </div>

            {mem ? (
              <>
                {/* 完整内容预览 */}
                <div className="mb-4 max-h-48 overflow-y-auto pr-2 custom-scrollbar">
                  <p className="text-sm leading-relaxed" style={{ color: '#5D4E37' }}>
                    {mem.content || mem.summary || '暂无内容'}
                  </p>
                </div>

                {/* 标签列表 */}
                <div className="flex flex-wrap gap-1.5 mb-4">
                  {node.keywords.map((kw) => (
                    <span
                      key={kw}
                      className="px-2.5 py-1 bg-[#FAF8F5] rounded-lg text-xs font-medium"
                      style={{ color: '#5D4E37', border: '1px solid #E8DCC8' }}
                    >
                      {kw}
                    </span>
                  ))}
                </div>

                {/* 底部元数据 */}
                <div className="flex items-center justify-between pt-4 border-t" style={{ borderColor: '#E8DCC8' }}>
                  <div className="flex items-center gap-4 text-xs" style={{ color: '#B8AE9A' }}>
                    <span>创建：{new Date(mem.createdAt).toLocaleDateString('zh-CN')}</span>
                    <span>更新：{new Date(mem.updatedAt).toLocaleDateString('zh-CN')}</span>
                  </div>
                  <span className="text-xs px-3 py-1.5 rounded-full font-semibold" style={{ background: 'linear-gradient(135deg, rgba(166,124,0,0.1), rgba(201,162,39,0.1))', color: '#A67C00' }}>
                    访问 {mem.accessCount} 次
                  </span>
                </div>
              </>
            ) : (
              <p className="text-sm text-[#B8AE9A] py-4">记忆数据加载中...</p>
            )}

            {/* 提示文字 */}
            <p className="text-xs text-center mt-4 pt-3 border-t" style={{ borderColor: '#E8DCC8', color: '#B8AE9A' }}>
              💡 点击其他节点查看 · 拖拽移动画布 · 滚轮缩放
            </p>
          </div>
        );
      })()}

      {/* ═══ 空状态提示 ═══ */}
      {nodes.length === 0 && !loading && (
        <div className="absolute inset-0 flex items-center justify-center z-10">
          <div className="text-center bg-white/95 backdrop-blur-md p-10 rounded-2xl shadow-xl border-2 border-dashed max-w-md" style={{ borderColor: '#D4C8B5' }}>
            <div className="w-20 h-20 mx-auto mb-6 rounded-full flex items-center justify-center" style={{ background: 'linear-gradient(135deg, rgba(166,124,0,0.1), rgba(201,162,39,0.1))' }}>
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#A67C00" strokeWidth="1.5">
                <circle cx="11" cy="11" r="8" />
                <path d="M21 21l-4.35-4.35" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-[#3E3224] mb-3 font-mono">暂无记忆数据</h2>
            <p className="text-sm text-[#8B7D6B] mb-6 leading-relaxed">
              该知识模块下还没有记忆内容<br/>开始使用系统后，记忆会自动聚合到这里
            </p>
            <button
              onClick={() => router.push('/')}
              className="cta-btn px-6 py-3 rounded-xl font-semibold"
            >
              返回首页 →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function KnowledgeMapPageWrapper() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-[calc(100vh-56px)]">
        <div className="loading-dots"><span /><span /><span /></div>
      </div>
    }>
      <KnowledgeMapPage />
    </Suspense>
  );
}
