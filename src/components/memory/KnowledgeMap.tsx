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

function inferCategory(mem: MemoryRecord): KnowledgeNode["category"] {
  const haystack = [mem.topic, mem.title, mem.summary, ...(mem.tags ?? [])].join(" ").toLowerCase();
  if (/(project|planning|roadmap|architecture|release|milestone|需求|规划|架构|项目)/.test(haystack)) {
    return "project";
  }
  if (/(work|job|meeting|review|bug|deploy|issue|workflow|任务|工作|会议|复盘|协作)/.test(haystack)) {
    return "work";
  }
  return "knowledge";
}

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
        category: inferCategory(mem),
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

    // 按码点处理首字符大写，避免截坏代理对（emoji 等）
    const chars = Array.from(name);
    const label = (chars[0] ?? "").toUpperCase() + chars.slice(1).join("");

    return {
      id: name,
      label,
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
  const [finderOpen, setFinderOpen] = useState(true);

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

  const categoryCounts = useMemo(
    () =>
      categoryRegions.map((region) => ({
        ...region,
        count: nodes.filter((node) => node.category === region.id).length,
      })),
    [nodes],
  );

  const selectedNode = selected ? nodeById.get(selected) ?? null : null;
  const selectedCount = activeFilter ? 1 : 0;

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
        className="h-full w-full cursor-grab active:cursor-grabbing"
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        role="img"
        aria-label="知识图谱，可拖拽、缩放并选择节点"
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        style={{ touchAction: "none" }}
      >
        <g transform={transform}>
          {/* ── 区域背景 ── */}
          {categoryCounts.map((region) => (
            <g key={region.id}>
              <rect
                x={region.x}
                y={region.y}
                width={region.w}
                height={region.h}
                rx={18}
                fill={region.color}
                stroke="rgba(166, 124, 0, 0.14)"
                strokeWidth={1.5}
                strokeDasharray="8 5"
              />
              <text
                x={region.x + 18}
                y={region.y + 28}
                className="font-mono select-none"
                fontSize={14}
                fill="#A67C00"
                fontWeight={600}
                opacity={0.76}
              >
                {region.label}
              </text>
              <text
                x={region.x + 18}
                y={region.y + 48}
                className="font-mono select-none"
                fontSize={11}
                fill="#8B7355"
                opacity={0.76}
              >
                {region.count} 个节点
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
                  {(() => {
                    // 按码点截断，避免切坏代理对
                    const chars = Array.from(node.label);
                    return chars.length > 10 ? chars.slice(0, 9).join("") + "…" : node.label;
                  })()}
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

      <div className="pointer-events-none absolute inset-0 z-10">
        {/* 左上：标题 + 搜索 + 筛选 */}
        <div className="pointer-events-auto absolute left-3 top-3 w-[320px] max-w-[calc(100%-1.5rem)] sm:left-5 sm:top-5 sm:w-[340px]">
          <div
            className="rounded-sm border p-4 backdrop-blur-sm"
            style={{
              background: "rgba(255, 253, 249, 0.9)",
              borderColor: "var(--card-border)",
              boxShadow: "var(--shadow-card)",
            }}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p
                  className="font-heading text-[0.62rem] font-semibold uppercase"
                  style={{ letterSpacing: "0.12em", color: "var(--foreground-subtle)" }}
                >
                  Memory Map
                </p>
                <h1
                  className="font-heading mt-1 text-lg font-bold leading-tight"
                  style={{ color: "var(--foreground)" }}
                >
                  知识图谱
                </h1>
                <p
                  className="font-body mt-1.5 text-xs leading-relaxed"
                  style={{ color: "var(--foreground-subtle)" }}
                >
                  按话题、标签和关系浏览长期记忆。
                </p>
              </div>

              <Link
                href="/memory"
                className="cta-btn inline-flex min-h-[36px] items-center px-3 py-1.5 font-heading text-[0.65rem] font-semibold uppercase"
                style={{ letterSpacing: "0.08em" }}
              >
                返回检索库
              </Link>
            </div>

            <button
              type="button"
              onClick={() => setFinderOpen((open) => !open)}
              className="cta-btn mt-3 flex w-full items-center justify-between px-3 py-2 font-heading text-xs font-semibold uppercase"
              aria-expanded={finderOpen}
              style={{
                letterSpacing: "0.08em",
                background: finderOpen ? "var(--foreground)" : "var(--accent)",
                color: finderOpen ? "var(--card-bg)" : "#ffffff",
              }}
            >
              <span>{finderOpen ? "隐藏筛选" : "显示筛选"}</span>
              <span>{finderOpen ? "↑" : "↓"}</span>
            </button>

            {finderOpen && (
              <div
                className="mt-3 border-t pt-3"
                style={{ borderColor: "var(--card-border)" }}
              >
                <div className="relative">
                  <svg
                    className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    style={{ color: "var(--accent)" }}
                  >
                    <circle cx="11" cy="11" r="8" />
                    <path d="M21 21l-4.35-4.35" />
                  </svg>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="搜索知识节点..."
                    className="input w-full pl-10 pr-16 text-sm"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery("")}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm px-2 py-1 text-[0.65rem] font-semibold uppercase"
                      style={{
                        letterSpacing: "0.08em",
                        color: "var(--foreground-subtle)",
                        background: "transparent",
                      }}
                    >
                      清除
                    </button>
                  )}
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {categoryCounts.map((cat) => {
                    const checked = activeFilter === cat.id;
                    return (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => setActiveFilter(checked ? null : cat.id)}
                        className="cta-btn inline-flex items-center gap-2 px-3 py-1.5 font-heading text-[0.65rem] font-semibold uppercase"
                        style={{
                          letterSpacing: "0.08em",
                          background: checked ? "var(--foreground)" : "var(--card-bg-alt)",
                          color: checked ? "var(--card-bg)" : "var(--foreground)",
                        }}
                      >
                        <span>{cat.label}</span>
                        <span className="text-[0.62rem] opacity-80">{cat.count}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 右上：统计信息 */}
        <div className="pointer-events-auto absolute right-4 top-4 hidden w-[220px] md:block">
          <div
            className="rounded-sm border px-4 py-3 backdrop-blur-sm"
            style={{
              background: "rgba(255, 253, 249, 0.86)",
              borderColor: "var(--card-border)",
              boxShadow: "var(--shadow-card)",
            }}
          >
            <p
              className="font-heading text-[0.62rem] font-semibold uppercase"
              style={{ letterSpacing: "0.1em", color: "var(--foreground-subtle)" }}
            >
              概览
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
              <div>
                <div className="font-mono text-lg font-bold" style={{ color: "var(--accent)" }}>
                  {filteredNodes.length}
                </div>
                <div style={{ color: "var(--foreground-subtle)" }}>可见节点</div>
              </div>
              <div>
                <div className="font-mono text-lg font-bold" style={{ color: "var(--accent)" }}>
                  {nodes.length}
                </div>
                <div style={{ color: "var(--foreground-subtle)" }}>总节点</div>
              </div>
              <div>
                <div className="font-mono text-lg font-bold" style={{ color: "var(--accent)" }}>
                  {edges.length}
                </div>
                <div style={{ color: "var(--foreground-subtle)" }}>连线</div>
              </div>
              <div>
                <div className="font-mono text-lg font-bold" style={{ color: "var(--accent)" }}>
                  {selectedCount}
                </div>
                <div style={{ color: "var(--foreground-subtle)" }}>筛选</div>
              </div>
            </div>
          </div>
        </div>

        {/* 右侧：节点 / 区域详情 */}
        {selectedNode && (
          <div className="pointer-events-auto absolute right-4 top-40 w-[330px] max-w-[calc(100%-2rem)]">
            <div
              className="rounded-sm border p-4 backdrop-blur-sm"
              style={{
                background: "rgba(255, 253, 249, 0.94)",
                borderColor: "var(--card-border)",
                boxShadow: "var(--shadow-card-hover)",
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p
                    className="font-heading text-[0.65rem] font-semibold uppercase"
                    style={{ letterSpacing: "0.12em", color: "var(--foreground-subtle)" }}
                  >
                    {categoryRegions.find((r) => r.id === selectedNode.category)?.label}
                  </p>
                  <h3
                    className="font-heading mt-1 text-base font-bold"
                    style={{ color: "var(--foreground)" }}
                  >
                    {selectedNode.label}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  aria-label="关闭详情"
                  className="font-heading text-sm leading-none"
                  style={{ color: "var(--foreground-subtle)" }}
                >
                  ✕
                </button>
              </div>

              <p
                className="font-body mt-2 text-[0.84rem] leading-relaxed"
                style={{ color: "var(--foreground-dim)" }}
              >
                包含 <span className="font-bold" style={{ color: "var(--accent)" }}>{selectedNode.count}</span>{" "}
                条记忆
              </p>

              {selectedNode.keywords.length > 0 && (
                <div className="mt-3">
                  <p
                    className="font-heading text-[0.6rem] font-semibold uppercase"
                    style={{ letterSpacing: "0.1em", color: "var(--foreground-subtle)" }}
                  >
                    关键词
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {selectedNode.keywords.map((kw) => (
                      <span
                        key={kw}
                        className="rounded-sm px-2 py-1 text-xs"
                        style={{
                          background: "var(--card-bg-alt)",
                          color: "var(--foreground-dim)",
                        }}
                      >
                        {kw}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <Link
                href={memoryTopicHref(selectedNode.id)}
                className="cta-btn mt-4 block w-full py-2.5 text-center text-sm font-semibold"
              >
                查看详情 →
              </Link>
            </div>
          </div>
        )}

        {/* 左下：图例 */}
        <div className="pointer-events-none absolute bottom-4 left-4 hidden md:block">
          <div
            className="rounded-sm border px-4 py-3"
            style={{
              background: "rgba(255, 253, 249, 0.86)",
              borderColor: "var(--card-border)",
              boxShadow: "var(--shadow-card)",
            }}
          >
            <div
              className="font-heading flex flex-col gap-1.5 text-[0.65rem]"
              style={{ letterSpacing: "0.05em", color: "var(--foreground-subtle)" }}
            >
              <span className="flex items-center gap-1.5">
                <svg width="30" height="14" viewBox="0 0 30 14" aria-hidden="true">
                  <circle cx="7" cy="7" r="6.5" fill="currentColor" />
                  <circle cx="22" cy="7" r="3" fill="currentColor" />
                </svg>
                节点大小代表记忆量
              </span>
              <span>高亮节点表示当前聚焦</span>
              <span style={{ opacity: 0.8 }}>虚线区域表示知识分区</span>
            </div>
          </div>
        </div>

        {/* 右下：缩放控制 */}
        <div className="pointer-events-auto absolute bottom-4 right-4 flex flex-col gap-2">
          <div
            className="rounded-sm border overflow-hidden"
            style={{
              background: "rgba(255, 253, 249, 0.92)",
              borderColor: "var(--card-border)",
              boxShadow: "var(--shadow-card)",
            }}
          >
            {[
              { label: "−", action: () => zoomOut(), aria: "缩小" },
              { label: "⌖", action: () => resetView(), aria: "重置视图" },
              { label: "+", action: () => zoomIn(), aria: "放大" },
            ].map((b) => (
              <button
                key={b.aria}
                type="button"
                onClick={b.action}
                aria-label={b.aria}
                className="cta-btn flex h-10 w-10 items-center justify-center text-sm font-semibold"
                style={{
                  background: "transparent",
                  color: "var(--foreground)",
                  boxShadow: "none",
                }}
              >
                {b.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
