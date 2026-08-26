'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import type { MemoryRecord } from '@/types/memory';

// 动态导入 HeroCanvas（避免 SSR 问题）
const HeroCanvas = dynamic(
  () => import('@/components/ui/HeroCanvas').then((mod) => ({ default: mod.HeroCanvas })),
  {
    ssr: false,
    loading: () => (
      <div className="absolute inset-0 bg-gradient-to-br from-[#FAF8F5] via-[#FFFDF9] to-[#F5F0E8]" />
    ),
  }
);

interface ViewState {
  x: number;
  y: number;
  k: number;
}

const VIEW_W = 1600;
const VIEW_H = 1000;
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 6;

// 将记忆数据转换为地图节点
interface KnowledgeNode {
  id: string;
  title: string;
  x: number;
  y: number;
  r: number; // 半径（基于访问次数）
  category: string;
  tags: string[];
  count: number; // 包含的记忆数量
  color: string; // 棕白金配色
  labelDy?: number; // 标签 Y 偏移
}

export default function MemoryMapPage() {
  const router = useRouter();
  const [memories, setMemories] = useState<MemoryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<ViewState>({ x: 0, y: 0, k: 1 });
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const svgRef = useRef<SVGSVGElement>(null);
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });

  // 加载记忆数据
  useEffect(() => {
    async function loadMemories() {
      try {
        const res = await fetch('/api/memory');
        if (res.ok) {
          const data = await res.json();
          setMemories(data.memories || []);
        }
      } catch (error) {
        console.error('Failed to load memories:', error);
      } finally {
        setLoading(false);
      }
    }
    loadMemories();
  }, []);

  // 将记忆聚合为知识节点
  const nodes: KnowledgeNode[] = useMemo(() => {
    const topicMap = new Map<
      string,
      {
        memories: MemoryRecord[];
        tags: Set<string>;
        category: string;
        visits: number;
      }
    >();

    memories.forEach((mem) => {
      const topic = mem.topic || 'general';
      const existing = topicMap.get(topic) || {
        memories: [] as MemoryRecord[],
        tags: new Set<string>(),
        category: (mem as any).category || 'knowledge',
        visits: 0,
      };
      existing.memories.push(mem);
      mem.tags.forEach((t) => existing.tags.add(t));
      existing.visits += mem.accessCount || 0;
      topicMap.set(topic, existing);
    });

    // 转换为节点数组，使用稳定的伪随机位置
    const result: KnowledgeNode[] = Array.from(topicMap.entries()).map(
      ([topic, data], index) => {
        // 基于主题的 hash 生成稳定的位置
        const hash = topic.split('').reduce((a, b) => ((a << 5) - a + b.charCodeAt(0)) | 0, 0);
        const x = Math.abs(hash % (VIEW_W - 200)) + 100;
        const y = Math.abs(((hash >> 8) % (VIEW_H - 200)) + 100);

        // 基于访问次数计算半径
        let r = 20;
        if (data.visits > 5) r = 32;
        else if (data.visits > 2) r = 26;

        // 配色方案（棕白金）
        const colors: Record<string, string> = {
          knowledge: '#8B7355', // 知识归纳 - 深棕
          work: '#A0522D', // 工作经验 - 赭石
          project: '#CD853F', // 项目沉淀 - 秘鲁色
        };

        return {
          id: topic,
          title: formatTopicName(topic),
          x,
          y,
          r,
          category: data.category,
          tags: Array.from(data.tags).slice(0, 5),
          count: data.memories.length,
          color: colors[data.category] || '#8B7355',
        };
      }
    );

    return result;
  }, [memories]);

  // 过滤节点
  const filteredNodes = useMemo(() => {
    if (!searchQuery.trim()) return nodes;
    const q = searchQuery.toLowerCase();
    return nodes.filter(
      (node) =>
        node.title.toLowerCase().includes(q) ||
        node.tags.some((t) => t.toLowerCase().includes(q))
    );
  }, [nodes, searchQuery]);

  // 鼠标事件处理
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.92 : 1.08;
      setView((prev) => ({
        ...prev,
        k: clampZoom(prev.k * factor),
      }));
    },
    []
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (e.target === svgRef.current || (e.target as HTMLElement).tagName === 'svg') {
        isDragging.current = true;
        dragStart.current = { x: e.clientX - view.x, y: e.clientY - view.y };
        (e.target as SVGSVGElement).setPointerCapture(e.pointerId);
      }
    },
    [view]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (isDragging.current) {
        setView((prev) => ({
          ...prev,
          x: e.clientX - dragStart.current.x,
          y: e.clientY - dragStart.current.y,
        }));
      }
    },
    []
  );

  const handlePointerUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  // 缩放控制
  const zoomIn = () => setView((v) => ({ ...v, k: clampZoom(v.k * 1.25) }));
  const zoomOut = () => setView((v) => ({ ...v, k: clampZoom(v.k * 0.8) }));
  const resetView = () => setView({ x: 0, y: 0, k: 1 });

  // 点击节点跳转
  const handleNodeClick = (nodeId: string) => {
    router.push(`/memory/${encodeURIComponent(nodeId)}`);
  };

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center" style={{ background: '#FAF8F5' }}>
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#C9A227] mx-auto mb-4" />
          <p style={{ color: '#5D4E37' }}>加载知识图谱...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-screen overflow-hidden" style={{ background: '#FAF8F5' }}>
      {/* 动态粒子背景 */}
      <div className="absolute inset-0 z-0">
        <HeroCanvas />
      </div>

      {/* 顶部导航栏 */}
      <div className="absolute top-0 left-0 right-0 z-30 px-6 py-4 flex items-center justify-between bg-gradient-to-b from-white/80 to-transparent backdrop-blur-sm">
        <div>
          <h1 className="text-xl font-bold font-mono tracking-tight" style={{ color: '#3E3224' }}>
            知识图谱
          </h1>
          <p className="text-sm mt-0.5" style={{ color: '#8B7355' }}>
            {filteredNodes.length} 个知识节点 · {memories.length} 条记忆
          </p>
        </div>

        <div className="flex items-center gap-4">
          {/* 搜索框 */}
          <input
            type="text"
            placeholder="搜索知识点..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="px-4 py-2 rounded-lg border border-[#E8DCC8] bg-white/90 text-sm focus:outline-none focus:border-[#C9A227] focus:ring-2 focus:ring-[#C9A227]/20 transition-all"
            style={{
              width: '240px',
              color: '#3E3224',
              fontFamily: 'monospace',
            }}
          />

          {/* 返回首页按钮 */}
          <Link
            href="/"
            className="px-4 py-2 rounded-lg text-sm font-medium transition-all hover:bg-[#C9A227] hover:text-white"
            style={{
              background: '#3E3224',
              color: '#FAF8F5',
              fontFamily: 'monospace',
            }}
          >
            返回首页
          </Link>
        </div>
      </div>

      {/* SVG 地图层 */}
      <svg
        ref={svgRef}
        className="absolute inset-0 z-10 cursor-grab active:cursor-grabbing"
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        style={{
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`,
          transformOrigin: '0 0',
        }}
      >
        {/* 连线 */}
        <g className="pointer-events-none">
          {filteredNodes.map((node, i) =>
            filteredNodes.slice(i + 1).map((other) => {
              // 如果有共同标签，绘制连线
              const sharedTags = node.tags.filter((t) => other.tags.includes(t));
              if (sharedTags.length === 0) return null;

              const dist = Math.sqrt(Math.pow(node.x - other.x, 2) + Math.pow(node.y - other.y, 2));
              if (dist > 300) return null;

              const opacity = Math.max(0.08, 0.25 * (1 - dist / 300));

              return (
                <line
                  key={`${node.id}-${other.id}`}
                  x1={node.x}
                  y1={node.y}
                  x2={other.x}
                  y2={other.y}
                stroke="#C9A227"
                strokeWidth={Math.max(0.5, sharedTags.length * 0.8)}
                opacity={
                  hoveredNode === node.id || hoveredNode === other.id ? opacity * 2.5 : opacity
                }
              />
              );
            })
          )}
        </g>

        {/* 节点 */}
        {filteredNodes.map((node) => {
          const isHovered = hoveredNode === node.id;
          const scale = isHovered ? 1.25 : 1;

          return (
            <g
              key={node.id}
              transform={`translate(${node.x}, ${node.y}) scale(${scale})`}
              onClick={() => handleNodeClick(node.id)}
              onMouseEnter={() => setHoveredNode(node.id)}
              onMouseLeave={() => setHoveredNode(null)}
              className="cursor-pointer transition-transform duration-200"
              style={{ transformOrigin: `${node.x}px ${node.y}px` }}
            >
              {/* 外发光效果（悬停时） */}
              {isHovered && (
                <circle
                  r={node.r + 10}
                  fill={node.color}
                  opacity={0.15}
                  className="animate-pulse"
                />
              )}

              {/* 主圆 */}
              <circle
                r={node.r}
                fill={node.color}
                stroke="#C9A227"
                strokeWidth={isHovered ? 2.5 : 1.5}
                opacity={isHovered ? 1 : 0.85}
                className="transition-all duration-200"
              />

              {/* 标签文字 */}
              <text
                textAnchor="middle"
                dominantBaseline="central"
                y={node.labelDy || 0}
                fontSize={12}
                fontWeight={600}
                fill="#FFFFFF"
                pointerEvents="none"
                className="select-none drop-shadow-sm"
              >
                {node.title.length > 6 ? node.title.slice(0, 5) + '..' : node.title}
              </text>

              {/* 计数徽章 */}
              {node.count > 1 && (
                <>
                  <circle cx={node.r - 4} cy={-node.r + 4} r={10} fill="#C9A227" />
                  <text
                    textAnchor="middle"
                    dominantBaseline="central"
                    x={node.r - 4}
                    y={-node.r + 4}
                    fontSize={9}
                    fontWeight={700}
                    fill="#3E3224"
                    pointerEvents="none"
                  >
                    {node.count}
                  </text>
                </>
              )}

              {/* 悬停提示 */}
              {isHovered && (
                <g transform={`translate(0, ${-node.r - 20})`}>
                  <rect
                    x={-80}
                    y={-16}
                    width={160}
                    height={32}
                    rx={6}
                    fill="#3E3224"
                    opacity={0.95}
                  />
                  <text
                    textAnchor="middle"
                    dominantBaseline="central"
                    y={0}
                    fontSize={11}
                    fill="#FAF8F5"
                    pointerEvents="none"
                    fontFamily="monospace"
                  >
                    点击查看详情 →
                  </text>
                </g>
              )}
            </g>
          );
        })}
      </svg>

      {/* 右下角缩放控制 */}
      <div className="absolute bottom-6 right-6 z-30 flex flex-col gap-2">
        <button
          onClick={zoomIn}
          className="w-10 h-10 rounded-lg bg-white/90 shadow-lg flex items-center justify-center text-lg font-bold hover:bg-[#C9A227] hover:text-white transition-all"
          style={{ color: '#3E3224' }}
        >
          ⊕
        </button>
        <button
          onClick={zoomOut}
          className="w-10 h-10 rounded-lg bg-white/90 shadow-lg flex items-center justify-center text-lg font-bold hover:bg-[#C9A227] hover:text-white transition-all"
          style={{ color: '#3E3224' }}
        >
          ⊖
        </button>
        <button
          onClick={resetView}
          className="w-10 h-10 rounded-lg bg-white/90 shadow-lg flex items-center justify-center text-sm font-bold hover:bg-[#C9A227] hover:text-white transition-all"
          style={{ color: '#3E3224' }}
        >
          ↺
        </button>
      </div>

      {/* 左下角图例 */}
      <div className="absolute bottom-6 left-6 z-30 p-4 rounded-xl bg-white/90 shadow-lg backdrop-blur-sm max-w-xs">
        <h3 className="font-mono font-bold text-sm mb-2" style={{ color: '#3E3224' }}>
          图例说明
        </h3>
        <div className="space-y-2 text-xs" style={{ color: '#5D4E37' }}>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full" style={{ background: '#8B7355' }} />
            <span>知识归纳</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full" style={{ background: '#A0522D' }} />
            <span>工作经验</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full" style={{ background: '#CD853F' }} />
            <span>项目沉淀</span>
          </div>
          <hr className="my-1 border-[#E8DCC8]" />
          <p className="opacity-70">节点大小反映活跃度</p>
          <p className="opacity-70">连线表示关联强度</p>
        </div>
      </div>
    </div>
  );
}

// 辅助函数：格式化主题名称
function formatTopicName(topic: string): string {
  // URL 解码
  try {
    const decoded = decodeURIComponent(topic);
    if (decoded !== topic) return decoded;
  } catch {}

  // 常见映射
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

  // 清理特殊字符
  const cleaned = topic.replace(/[-_]/g, ' ').replace(/[^a-zA-Z0-9\u4e00-\u9fa5\s]/g, '');

  // 如果是纯英文，首字母大写
  if (/^[a-zA-Z\s]+$/.test(cleaned)) {
    return cleaned
      .split(' ')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  // 回退到原始字符串（截断过长）
  return cleaned.length > 15 ? cleaned.slice(0, 15) + '...' : cleaned || '未命名';
}

function clampZoom(k: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, k));
}
