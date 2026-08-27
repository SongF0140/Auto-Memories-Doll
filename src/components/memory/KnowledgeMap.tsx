"use client";

import Link from "next/link";
import React from "react";
import { useCallback, useMemo, useRef, useState } from "react";
import { memoryTopicHref } from "@/lib/memory-api-client";
import type { MemoryRecord } from "@/types/memory";

/* ── 常量与类型 ── */

const VIEW_W = 1400;
const VIEW_H = 900;
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 6;

interface ViewState {
  x: number;
  y: number;
  k: number;
}

export interface KnowledgeNode {
  id: string;
  label: string;
  x: number;
  y: number;
  category: "knowledge" | "work" | "project";
  count: number;
  keywords: string[];
  memoryIds: string[];
  status: "active" | "normal" | "small";
}

interface KnowledgeEdge {
  from: string;
  to: string;
  strength?: number;
}

interface CategoryRegion {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
}

/* ── 分类区域配置（棕白金配色） ── */
const categoryRegions: CategoryRegion[] = [
  {
    id: "knowledge",
    label: "知识归纳",
    x: 100,
    y: 80,
    w: 480,
    h: 360,
    color: "rgba(166, 124, 0, 0.08)",
  },
  {
    id: "work",
    label: "工作经验",
    x: 620,
    y: 80,
    w: 480,
    h: 360,
    color: "rgba(201, 162, 39, 0.08)",
  },
  {
    id: "project",
    label: "项目沉淀",
    x: 360,
    y: 480,
    w: 480,
    h: 340,
    color: "rgba(160, 120, 60, 0.08)",
  },
];

/* ── 将记忆数据转换为节点 ── */
export function buildKnowledgeGraph(memories: MemoryRecord[]): {
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
} {
  const topicMap = new Map<
    string,
    { memories: MemoryRecord[]; keywords: Set<string>; category: "knowledge" | "work" | "project" }
  >();

  // 聚合记忆到主题
  memories.forEach((mem: MemoryRecord) => {
    const topic = mem.topic || "general";
    let existing = topicMap.get(topic);
    if (!existing) {
      existing = {
        memories: [],
        keywords: new Set<string>(),
        category: "knowledge",
      };
      topicMap.set(topic, existing);
    }
    existing.memories.push(mem);
    mem.tags.forEach((t) => existing!.keywords.add(t));
  });

  // 创建节点
  const nodes: KnowledgeNode[] = Array.from(topicMap.entries()).map(([name, data], index) => {
    const region = categoryRegions.find((r) => r.id === data.category) || categoryRegions[0];
    const offsetX = ((index * 137) % (region.w - 100)) + 50;
    const offsetY = ((index * 97) % (region.h - 80)) + 40;

    const status: KnowledgeNode["status"] =
      data.memories.length > 5 ? "active" : data.memories.length > 2 ? "normal" : "small";

    return {
      id: name,
      label: name.charAt(0).toUpperCase() + name.slice(1),
      x: region.x + offsetX,
      y: region.y + offsetY,
      category: data.category,
      count: data.memories.length,
      keywords: Array.from(data.keywords).slice(0, 6),
      memoryIds: data.memories.map((m) => m.id),
      status,
    };
  });

  // 创建边（基于共同关键词）
  const edges: KnowledgeEdge[] = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const commonKeywords = nodes[i].keywords.filter((k) => nodes[j].keywords.includes(k));
      if (commonKeywords.length > 0) {
        edges.push({
          from: nodes[i].id,
          to: nodes[j].id,
          strength: commonKeywords.length,
        });
      }
    }
  }

  return { nodes, edges };
}

/* ── 节点大小配置 ── */
const nodeRadius: Record<KnowledgeNode["status"], number> = {
  active: 28,
  normal: 22,
  small: 16,
};

const fontSize: Record<KnowledgeNode["status"], number> = {
  active: 13,
  normal: 11,
  small: 10,
};

function clampZoom(k: number) {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, k));
}

/* ── 主组件 ── */
interface KnowledgeMapProps {
  memories: MemoryRecord[];
  onNodeClick?: (node: KnowledgeNode) => void;
  onNodeHover?: (node: KnowledgeNode | null) => void;
}

export default function KnowledgeMap({ memories, onNodeClick, onNodeHover }: KnowledgeMapProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState<ViewState>({ x: 0, y: 0, k: 1 });
  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [lastMouse, setLastMouse] = useState({ x: 0, y: 0 });
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<string | null>(null);

  const { nodes, edges } = useMemo(() => buildKnowledgeGraph(memories), [memories]);

  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  // 过滤逻辑
  const filteredNodes = useMemo(() => {
    if (!searchQuery.trim() && !activeFilter) return nodes;

    return nodes.filter((node) => {
      const matchSearch =
        !searchQuery.trim() ||
        node.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
        node.keywords.some((k) => k.toLowerCase().includes(searchQuery.toLowerCase()));

      const matchFilter = !activeFilter || node.category === activeFilter;

      return matchSearch && matchFilter;
    });
  }, [nodes, searchQuery, activeFilter]);

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

  const handleWheel = useCallback(
    (e: React.WheelEvent<SVGSVGElement>) => {
      e.preventDefault();
      if (!svgRef.current) return;

      const rect = svgRef.current.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      const factor = e.deltaY > 0 ? 0.92 : 1.08;
      const newK = clampZoom(view.k * factor);

      // 以鼠标位置为中心缩放
      const newX = mx - (mx - view.x) * (newK / view.k);
      const newY = my - (my - view.y) * (newK / view.k);

      setView({ x: newX, y: newY, k: newK });
    },
    [view],
  );

  const handlePointerDown = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    setDragging(true);
    setLastMouse({ x: e.clientX, y: e.clientY });
    (e.target as SVGElement).setPointerCapture(e.pointerId);
  }, []);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (dragging) {
        const dx = e.clientX - lastMouse.x;
        const dy = e.clientY - lastMouse.y;
        setView((prev) => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
        setLastMouse({ x: e.clientX, y: e.clientY });
      }
    },
    [dragging, lastMouse],
  );

  const handlePointerUp = useCallback(() => {
    setDragging(false);
  }, []);

  const resetView = useCallback(() => {
    setView({ x: 0, y: 0, k: 1 });
    setSelected(null);
    setHovered(null);
  }, []);

  const zoomIn = useCallback(() => {
    setView((prev) => ({ ...prev, k: clampZoom(prev.k * 1.3) }));
  }, []);

  const zoomOut = useCallback(() => {
    setView((prev) => ({ ...prev, k: clampZoom(prev.k * 0.77) }));
  }, []);

  /* ── 节点交互 ── */

  const handleNodeClick = useCallback(
    (nodeId: string) => {
      const node = nodeById.get(nodeId);
      if (!node) return;

      setSelected(nodeId === selected ? null : nodeId);
      onNodeClick?.(node);
    },
    [nodeById, selected, onNodeClick],
  );

  const handleNodeEnter = useCallback(
    (nodeId: string) => {
      setHovered(nodeId);
      const node = nodeById.get(nodeId);
      onNodeHover?.(node || null);
    },
    [nodeById, onNodeHover],
  );

  const handleNodeLeave = useCallback(() => {
    setHovered(null);
    onNodeHover?.(null);
  }, [onNodeHover]);

  /* ── 渲染 ── */

  const transform = `translate(${view.x}, ${view.y}) scale(${view.k})`;

  return (
    <div
      className="relative w-full h-full overflow-hidden"
      style={{ background: "var(--background-warm)" }}
    >
      {/* SVG 地图 */}
      <svg
        ref={svgRef}
        className="w-full h-full cursor-grab active:cursor-grabbing"
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        style={{ touchAction: "none" }}
      >
        <g transform={transform}>
          {/* ── 区域背景 ── */}
          {categoryRegions.map((region) => (
            <g key={region.id}>
              <rect
                x={region.x}
                y={region.y}
                width={region.w}
                height={region.h}
                rx={16}
                fill={region.color}
                stroke="rgba(166, 124, 0, 0.15)"
                strokeWidth={1.5}
                strokeDasharray="8 4"
              />
              <text
                x={region.x + 16}
                y={region.y + 28}
                className="font-mono"
                fontSize={14}
                fill="#A67C00"
                fontWeight={600}
                opacity={0.7}
              >
                {region.label}
              </text>
            </g>
          ))}

          {/* ── 连线 ── */}
          {edges.map((edge, i) => {
            const fromNode = nodeById.get(edge.from);
            const toNode = nodeById.get(edge.to);
            if (!fromNode || !toNode) return null;

            const isRelated = relatedNodes?.has(edge.from) && relatedNodes?.has(edge.to);
            const isHighlighted = relatedNodes && isRelated;

            // 如果有过滤器，只显示关联节点的连线
            if (relatedNodes && !isHighlighted) return null;

            const opacity = isHighlighted ? 0.6 : 0.12;
            const strokeWidth = isHighlighted
              ? (edge.strength || 1) * 1.5
              : (edge.strength || 1) * 0.8;

            return (
              <line
                key={`edge-${i}`}
                x1={fromNode.x}
                y1={fromNode.y}
                x2={toNode.x}
                y2={toNode.y}
                stroke="#A67C00"
                strokeWidth={Math.min(strokeWidth, 4)}
                opacity={opacity}
                strokeLinecap="round"
              />
            );
          })}

          {/* ── 节点 ── */}
          {filteredNodes.map((node) => {
            const isHovered = hovered === node.id;
            const isSelected = selected === node.id;
            const isRelated = relatedNodes?.has(node.id);
            const r = nodeRadius[node.status];

            // 透明度计算
            let opacity = 1;
            if (relatedNodes && !isRelated) opacity = 0.15;
            if (searchQuery && !isHovered && !isSelected) opacity = 0.9;

            // 缩放动画
            const scale = isHovered || isSelected ? 1.15 : 1;
            const displayR = r * scale;

            return (
              <g
                key={node.id}
                onClick={() => handleNodeClick(node.id)}
                onMouseEnter={() => handleNodeEnter(node.id)}
                onMouseLeave={handleNodeLeave}
                className="cursor-pointer"
                style={{ transition: "transform 0.2s ease" }}
              >
                {/* 外发光效果（选中/悬停时） */}
                {(isHovered || isSelected) && (
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={displayR + 8}
                    fill="rgba(166, 124, 0, 0.15)"
                    className="animate-pulse"
                  />
                )}

                {/* 节点圆 */}
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={displayR}
                  fill={isSelected ? "#D4B84A" : isHovered ? "#C9A227" : "#3E3224"}
                  stroke={isSelected ? "#F5F0E8" : "#A67C00"}
                  strokeWidth={isSelected ? 2.5 : 1.5}
                  opacity={opacity}
                  style={{ transition: "all 0.2s ease" }}
                />

                {/* 节点标签 */}
                <text
                  textAnchor="middle"
                  dominantBaseline="central"
                  x={node.x}
                  y={node.y}
                  className="font-mono pointer-events-none"
                  fontSize={fontSize[node.status]}
                  fontWeight={isSelected || isHovered ? 700 : 500}
                  fill={isSelected || isHovered ? "#3E3224" : "#F5F0E8"}
                  opacity={opacity}
                >
                  {node.label.length > 10 ? node.label.slice(0, 9) + "…" : node.label}
                </text>

                {/* 计数徽章 */}
                {node.count > 1 && (
                  <g>
                    <circle
                      cx={node.x + displayR - 4}
                      cy={node.y - displayR + 4}
                      r={10}
                      fill="#C9A227"
                      opacity={opacity}
                    />
                    <text
                      textAnchor="middle"
                      dominantBaseline="central"
                      x={node.x + displayR - 4}
                      y={node.y - displayR + 4}
                      fontSize={9}
                      fontWeight={700}
                      fill="#3E3224"
                      opacity={opacity}
                      className="pointer-events-none"
                    >
                      {node.count}
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      {/* ── 控制面板 ── */}
      <div className="absolute top-4 left-4 z-10 space-y-3">
        {/* 搜索框 */}
        <div className="bg-white/95 backdrop-blur-sm rounded-xl shadow-lg border border-[#E8E0D4] p-3">
          <div className="relative">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#A67C00]"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索知识节点..."
              className="w-56 pl-10 pr-4 py-2 rounded-lg border border-[#E8E0D4] bg-white text-sm text-[#3E3224] placeholder:text-[#B8AE9A] focus:outline-none focus:border-[#A67C00] focus:ring-1 focus:ring-[#A67C00]/30"
            />
          </div>

          {/* 分类过滤 */}
          <div className="flex gap-2 mt-3">
            {categoryRegions.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setActiveFilter(activeFilter === cat.id ? null : cat.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  activeFilter === cat.id
                    ? "bg-[#A67C00] text-white"
                    : "bg-[#FAF8F5] text-[#5D4E37] hover:bg-[#F0EBE1]"
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 缩放控制 */}
      <div className="absolute bottom-6 right-6 z-10 flex flex-col gap-2">
        <button
          onClick={zoomIn}
          className="w-10 h-10 bg-white/95 backdrop-blur-sm rounded-xl shadow-lg border border-[#E8E0D4] flex items-center justify-center hover:bg-[#FAF8F5] transition-colors text-[#3E3224]"
          title="放大"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35M11 8v6M8 11h6" />
          </svg>
        </button>
        <button
          onClick={zoomOut}
          className="w-10 h-10 bg-white/95 backdrop-blur-sm rounded-xl shadow-lg border border-[#E8E0D4] flex items-center justify-center hover:bg-[#FAF8F5] transition-colors text-[#3E3224]"
          title="缩小"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35M8 11h6" />
          </svg>
        </button>
        <button
          onClick={resetView}
          className="w-10 h-10 bg-white/95 backdrop-blur-sm rounded-xl shadow-lg border border-[#E8E0D4] flex items-center justify-center hover:bg-[#FAF8F5] transition-colors text-[#3E3224]"
          title="重置视图"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
          </svg>
        </button>
      </div>

      {/* 节点详情面板（悬停/选中时显示） */}
      {(hovered || selected) &&
        (() => {
          const nodeId = selected || hovered;
          const node = nodeById.get(nodeId!);
          if (!node) return null;

          return (
            <div
              className="absolute bottom-6 left-6 z-10 bg-white/98 backdrop-blur-sm rounded-2xl shadow-2xl border border-[#E8E0D4] p-5 max-w-sm animate-fade-in"
              style={{ animationDuration: "0.2s" }}
            >
              <div className="flex items-start justify-between mb-3">
                <h3 className="text-lg font-bold text-[#3E3224] font-mono">{node.label}</h3>
                <span
                  className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
                    node.category === "knowledge"
                      ? "bg-blue-50 text-blue-700"
                      : node.category === "work"
                        ? "bg-green-50 text-green-700"
                        : "bg-purple-50 text-purple-700"
                  }`}
                >
                  {categoryRegions.find((r) => r.id === node.category)?.label}
                </span>
              </div>

              <p className="text-sm text-[#5D4E37] mb-3">
                包含 <span className="font-bold text-[#A67C00]">{node.count}</span> 条记忆
              </p>

              {node.keywords.length > 0 && (
                <div className="mb-4">
                  <p className="text-xs font-medium text-[#8B7D6B] mb-2">关键词</p>
                  <div className="flex flex-wrap gap-1.5">
                    {node.keywords.map((kw) => (
                      <span
                        key={kw}
                        className="px-2 py-1 bg-[#FAF8F5] rounded-md text-xs text-[#5D4E37]"
                      >
                        {kw}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <Link
                href={memoryTopicHref(node.id)}
                className="cta-btn w-full block text-center py-2.5 rounded-xl font-semibold text-sm"
              >
                查看详情 →
              </Link>
            </div>
          );
        })()}

      {/* 统计信息 */}
      <div className="absolute top-4 right-4 z-10 bg-white/90 backdrop-blur-sm rounded-xl px-4 py-2.5 shadow-md border border-[#E8E0D4]">
        <p className="text-xs text-[#8B7D6B] font-mono">
          <span className="font-bold text-[#A67C00]">{filteredNodes.length}</span> / {nodes.length}{" "}
          个节点
          {edges.length > 0 && (
            <>
              {" "}
              · <span className="font-bold text-[#A67C00]">{edges.length}</span> 条连线
            </>
          )}
        </p>
      </div>
    </div>
  );
}
