"use client";

import React from "react";
import {
  type KnowledgeCategory,
  type KnowledgeNode,
  type CategoryRegion,
} from "./knowledge-map-data";

interface MapHeaderProps {
  title: string;
  subtitle: string;
  finderOpen: boolean;
  finderActive: boolean;
  selectedCount: number;
  onToggleFinder: () => void;
  onClearFilters: () => void;
  onCategoryToggle: (category: KnowledgeCategory) => void;
  categoryCounts: Array<CategoryRegion & { count: number }>;
  query: string;
  onQueryChange: (value: string) => void;
  activeCategory: KnowledgeCategory | null;
}

export const KnowledgeMapHeader = ({
  title,
  subtitle,
  finderOpen,
  finderActive,
  selectedCount,
  onToggleFinder,
  onClearFilters,
  onCategoryToggle,
  categoryCounts,
  query,
  onQueryChange,
  activeCategory,
}: MapHeaderProps) => {
  return (
    <div className="pointer-events-none absolute left-3 top-3 z-10 w-[300px] max-w-[calc(100%-1.5rem)] sm:left-5 sm:top-5 sm:w-[330px]">
      <div className="pointer-events-auto map-overlay-card rounded-sm p-3.5 sm:p-4">
        <h1 className="font-heading text-lg font-bold leading-tight sm:text-xl">{title}</h1>
        <p className="font-body mt-1.5 text-xs leading-relaxed text-text-secondary">{subtitle}</p>
        <button
          type="button"
          onClick={onToggleFinder}
          aria-expanded={finderOpen}
          className="cta-btn mt-3 flex w-full items-center justify-between px-3 py-2 font-heading text-xs font-semibold uppercase"
          style={{
            letterSpacing: "0.08em",
            background: finderOpen ? "var(--foreground)" : "var(--accent)",
            color: finderOpen ? "var(--card-bg)" : "#ffffff",
          }}
        >
          <span>{finderOpen ? "隐藏筛选" : "显示筛选"}</span>
          <span>{finderActive ? String(selectedCount) : finderOpen ? "↑" : "↓"}</span>
        </button>
        {finderOpen && (
          <FinderPanel
            query={query}
            onQueryChange={onQueryChange}
            categoryCounts={categoryCounts}
            onClearFilters={onClearFilters}
            onCategoryToggle={onCategoryToggle}
            activeCategory={activeCategory}
          />
        )}
      </div>
    </div>
  );
};

interface FinderPanelProps {
  query: string;
  onQueryChange: (value: string) => void;
  categoryCounts: Array<CategoryRegion & { count: number }>;
  onClearFilters: () => void;
  onCategoryToggle: (category: KnowledgeCategory) => void;
  activeCategory: KnowledgeCategory | null;
}

const FinderPanel = ({
  query,
  onQueryChange,
  categoryCounts,
  onClearFilters,
  onCategoryToggle,
  activeCategory,
}: FinderPanelProps) => {
  return (
    <div className="mt-3 border-t pt-3" style={{ borderColor: "var(--card-border)" }}>
      <div className="relative">
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="搜索知识节点..."
          className="input w-full pr-16 text-sm"
        />
        {query && (
          <button
            type="button"
            onClick={() => onQueryChange("")}
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
        {categoryCounts.map((category) => (
          <button
            key={category.id}
            type="button"
            onClick={() => onCategoryToggle(category.id)}
            className="cta-btn inline-flex items-center gap-2 px-3 py-1.5 font-heading text-[0.65rem] font-semibold uppercase"
            style={{
              letterSpacing: "0.08em",
              background:
                activeCategory === category.id ? "var(--foreground)" : "var(--card-bg-alt)",
              color: activeCategory === category.id ? "var(--card-bg)" : "var(--foreground)",
            }}
          >
            <span>{category.label}</span>
            <span className="text-[0.62rem] opacity-80">{category.count}</span>
          </button>
        ))}
        <button
          type="button"
          onClick={onClearFilters}
          className="cta-btn inline-flex items-center gap-2 px-3 py-1.5 font-heading text-[0.65rem] font-semibold uppercase"
          style={{
            letterSpacing: "0.08em",
            background: "var(--foreground)",
            color: "var(--card-bg)",
          }}
        >
          重置
        </button>
      </div>
    </div>
  );
};

interface SummaryProps {
  nodesCount: number;
  visibleCount: number;
  edgesCount: number;
  selectedCount: number;
}

export const KnowledgeMapSummary = ({
  nodesCount,
  visibleCount,
  edgesCount,
  selectedCount,
}: SummaryProps) => (
  <div className="pointer-events-auto absolute right-4 top-4 hidden w-[220px] md:block">
    <div className="map-overlay-card rounded-sm px-4 py-3">
      <p
        className="font-heading text-[0.62rem] font-semibold uppercase"
        style={{ letterSpacing: "0.1em", color: "var(--foreground-subtle)" }}
      >
        概览
      </p>
      <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
        <Metric label="可见节点" value={visibleCount} />
        <Metric label="总节点" value={nodesCount} />
        <Metric label="连线" value={edgesCount} />
        <Metric label="筛选" value={selectedCount} />
      </div>
    </div>
  </div>
);

const Metric = ({ label, value }: { label: string; value: number }) => (
  <div>
    <div className="font-mono text-lg font-bold text-accent">{value}</div>
    <div className="text-text-secondary">{label}</div>
  </div>
);

interface DetailProps {
  node: KnowledgeNode;
  regionLabel?: string;
  onClose: () => void;
}

export const KnowledgeMapDetail = ({ node, regionLabel, onClose }: DetailProps) => (
  <div className="pointer-events-auto absolute right-4 top-40 w-[330px] max-w-[calc(100%-2rem)]">
    <div className="map-overlay-card rounded-sm p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p
            className="font-heading text-[0.65rem] font-semibold uppercase"
            style={{ letterSpacing: "0.12em", color: "var(--foreground-subtle)" }}
          >
            {regionLabel}
          </p>
          <h3 className="font-heading mt-1 text-base font-bold text-text-primary">{node.label}</h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭详情"
          className="font-heading text-sm leading-none text-text-secondary"
        >
          ✕
        </button>
      </div>
      <p className="font-body mt-2 text-[0.84rem] leading-relaxed text-text-secondary">
        包含 <span className="font-bold text-accent">{node.count}</span> 条记忆
      </p>
      {node.keywords.length > 0 && (
        <div className="mt-3">
          <p
            className="font-heading text-[0.6rem] font-semibold uppercase"
            style={{ letterSpacing: "0.1em", color: "var(--foreground-subtle)" }}
          >
            关键词
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {node.keywords.map((keyword) => (
              <span
                key={keyword}
                className="rounded-sm px-2 py-1 text-xs"
                style={{ background: "var(--card-bg-alt)", color: "var(--foreground-dim)" }}
              >
                {keyword}
              </span>
            ))}
          </div>
        </div>
      )}
      <a
        href={`/memory/topic/${encodeURIComponent(node.id)}`}
        className="cta-btn mt-4 block w-full py-2.5 text-center text-sm font-semibold"
      >
        查看详情 →
      </a>
    </div>
  </div>
);

export const KnowledgeMapLegend = () => (
  <div className="pointer-events-none absolute bottom-4 left-4 hidden md:block">
    <div className="map-overlay-card rounded-sm px-4 py-3">
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
);

interface ZoomProps {
  onZoomOut: () => void;
  onReset: () => void;
  onZoomIn: () => void;
}

export const KnowledgeMapZoom = ({ onZoomOut, onReset, onZoomIn }: ZoomProps) => (
  <div className="pointer-events-auto absolute bottom-4 right-4 flex flex-col gap-2">
    <div className="map-overlay-card overflow-hidden rounded-sm">
      {[
        { label: "−", action: onZoomOut, aria: "缩小" },
        { label: "⌖", action: onReset, aria: "重置视图" },
        { label: "+", action: onZoomIn, aria: "放大" },
      ].map((button) => (
        <button
          key={button.aria}
          type="button"
          onClick={button.action}
          aria-label={button.aria}
          className="cta-btn flex h-10 w-10 items-center justify-center text-sm font-semibold"
          style={{ background: "transparent", color: "var(--foreground)", boxShadow: "none" }}
        >
          {button.label}
        </button>
      ))}
    </div>
  </div>
);
