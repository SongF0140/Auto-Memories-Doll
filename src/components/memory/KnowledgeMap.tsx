"use client";

import React from "react";
import type { MemoryRecord } from "@/types/memory";
import { KnowledgeMapScene } from "./KnowledgeMapScene";
import {
  KnowledgeMapDetail,
  KnowledgeMapHeader,
  KnowledgeMapLegend,
  KnowledgeMapSummary,
  KnowledgeMapZoom,
} from "./knowledge-map-panels";
import { type KnowledgeNode, type KnowledgeCategory } from "./knowledge-map-data";
import { useKnowledgeMapState } from "./knowledge-map-state";
import { useKnowledgeMapViewport } from "./knowledge-map-viewport";

interface KnowledgeMapProps {
  memories: MemoryRecord[];
  onNodeClick?: (node: KnowledgeNode) => void;
  onNodeHover?: (node: KnowledgeNode | null) => void;
}

const regionLabelByCategory: Record<KnowledgeCategory, string> = {
  knowledge: "知识归纳",
  work: "工作经验",
  project: "项目沉淀",
};

const KnowledgeMapShell = ({ memories, onNodeClick, onNodeHover }: KnowledgeMapProps) => {
  const state = useKnowledgeMapState(memories);
  const viewport = useKnowledgeMapViewport(state.setView);

  const selectedCategory = state.selectedNode?.category ?? state.activeCategory;
  const nodeById = new Map(state.nodes.map((node) => [node.id, node]));
  const clearSelectionAndHover = () => {
    state.resetSelection();
  };
  const handleCategoryToggle = (category: KnowledgeCategory) => {
    state.toggleCategory(category);
    clearSelectionAndHover();
  };
  const handleRegionSelect = (category: KnowledgeCategory) => {
    state.setActiveCategory(category);
    clearSelectionAndHover();
  };
  const handleClearFilters = () => {
    state.clearFilters();
    clearSelectionAndHover();
  };

  return (
    <div
      className="relative h-full w-full overflow-hidden grain-overlay"
      style={{ background: "var(--background-warm)" }}
    >
      <KnowledgeMapScene
        edges={state.edges}
        filteredNodes={state.filteredNodes}
        selectedNode={state.selectedNode}
        relatedNodeIds={state.relatedNodeIds}
        view={state.view}
        hoveredId={state.hoveredId}
        selectedId={state.selectedId}
        nodeById={nodeById}
        onHoveredId={(value) => {
          state.setHoveredId(value);
          onNodeHover?.(value ? (nodeById.get(value) ?? null) : null);
        }}
        onSelectedId={(value) => {
          state.setSelectedId(value);
          if (!value) return;
          const selectedNode = nodeById.get(value);
          if (selectedNode) onNodeClick?.(selectedNode);
        }}
        onBackgroundClick={() => state.resetSelection()}
        onZoomPan={{
          svgRef: viewport.svgRef,
          onWheel: viewport.onWheel,
          onPointerDown: viewport.onPointerDown,
          onPointerMove: viewport.onPointerMove,
          onPointerUp: viewport.onPointerUp,
        }}
        onRegionSelect={handleRegionSelect}
        selectedRegion={selectedCategory}
      />
      <KnowledgeMapHeader
        title="知识图谱"
        subtitle="按话题、标签和关系浏览长期记忆。"
        finderOpen={state.finderOpen}
        finderActive={state.finderActive}
        selectedCount={state.selectedCount}
        onToggleFinder={state.toggleFinder}
        onClearFilters={handleClearFilters}
        onCategoryToggle={handleCategoryToggle}
        categoryCounts={state.categoryCounts}
        query={state.query}
        onQueryChange={state.setQuery}
        activeCategory={state.activeCategory}
      />
      <KnowledgeMapSummary
        nodesCount={state.nodes.length}
        visibleCount={state.filteredNodes.length}
        edgesCount={state.edges.length}
        selectedCount={state.selectedCount}
      />
      {state.selectedNode && (
        <KnowledgeMapDetail
          node={state.selectedNode}
          regionLabel={regionLabelByCategory[state.selectedNode.category]}
          onClose={() => state.setSelectedId(null)}
        />
      )}
      <KnowledgeMapLegend />
      <KnowledgeMapZoom
        onZoomOut={() => viewport.zoomBy(1 / 1.35)}
        onReset={viewport.resetView}
        onZoomIn={() => viewport.zoomBy(1.35)}
      />
    </div>
  );
};

export default KnowledgeMapShell;

export type { KnowledgeNode } from "./knowledge-map-data";
