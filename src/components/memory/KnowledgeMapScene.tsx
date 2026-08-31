"use client";

import React from "react";
import type {
  PointerEvent as ReactPointerEvent,
  RefObject,
  WheelEvent as ReactWheelEvent,
} from "react";
import {
  VIEW_W,
  VIEW_H,
  fontSize,
  nodeRadius,
  type KnowledgeEdge,
  type KnowledgeNode,
  type KnowledgeCategory,
  type ViewState,
  categoryRegions,
} from "./knowledge-map-data";

interface KnowledgeMapSceneProps {
  edges: KnowledgeEdge[];
  filteredNodes: KnowledgeNode[];
  selectedNode: KnowledgeNode | null;
  relatedNodeIds: Set<string> | null;
  view: ViewState;
  hoveredId: string | null;
  selectedId: string | null;
  nodeById: Map<string, KnowledgeNode>;
  onHoveredId: (value: string | null) => void;
  onSelectedId: (value: string | null) => void;
  onBackgroundClick: () => void;
  onZoomPan: {
    svgRef: RefObject<SVGSVGElement>;
    onWheel: (event: ReactWheelEvent<SVGSVGElement>) => void;
    onPointerDown: (event: ReactPointerEvent<SVGSVGElement>) => void;
    onPointerMove: (event: ReactPointerEvent<SVGSVGElement>) => void;
    onPointerUp: (event: ReactPointerEvent<SVGSVGElement>) => void;
  };
  onRegionSelect: (category: KnowledgeCategory) => void;
  selectedRegion: KnowledgeCategory | null;
}

const nodeOpacity = (
  node: KnowledgeNode,
  relatedNodeIds: Set<string> | null,
  selectedRegion: KnowledgeCategory | null,
) => {
  if (relatedNodeIds) return relatedNodeIds.has(node.id) ? 1 : 0.15;
  if (selectedRegion) return node.category === selectedRegion ? 1 : 0.13;
  return 1;
};

const edgeOpacity = (edge: KnowledgeEdge, relatedNodeIds: Set<string> | null) => {
  if (!relatedNodeIds) return 0.17;
  return relatedNodeIds.has(edge.from) && relatedNodeIds.has(edge.to) ? 0.65 : 0.05;
};

export const KnowledgeMapScene = ({
  edges,
  filteredNodes,
  selectedNode,
  relatedNodeIds,
  view,
  hoveredId,
  selectedId,
  nodeById,
  onHoveredId,
  onSelectedId,
  onBackgroundClick,
  onZoomPan,
  onRegionSelect,
  selectedRegion,
}: KnowledgeMapSceneProps) => {
  const transform = `translate(${view.x},${view.y}) scale(${view.k})`;

  return (
    <svg
      ref={onZoomPan.svgRef}
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      className="h-full w-full"
      style={{ touchAction: "none", cursor: "grab" }}
      role="group"
      aria-label="知识图谱，可拖拽、缩放并选择节点"
      onWheel={onZoomPan.onWheel}
      onPointerDown={onZoomPan.onPointerDown}
      onPointerMove={onZoomPan.onPointerMove}
      onPointerUp={onZoomPan.onPointerUp}
      onPointerCancel={onZoomPan.onPointerUp}
      onClick={onBackgroundClick}
    >
      <g transform={transform}>
        <RegionLabels selectedRegion={selectedRegion} onRegionSelect={onRegionSelect} />
        <Edges edges={edges} nodeById={nodeById} relatedNodeIds={relatedNodeIds} />
        <Nodes
          filteredNodes={filteredNodes}
          hoveredId={hoveredId}
          selectedId={selectedId}
          relatedNodeIds={relatedNodeIds}
          selectedRegion={selectedRegion}
          onHoveredId={onHoveredId}
          onSelectedId={onSelectedId}
        />
        <SelectedRing selectedNode={selectedNode} />
      </g>
    </svg>
  );
};

interface RegionLabelsProps {
  selectedRegion: KnowledgeCategory | null;
  onRegionSelect: (category: KnowledgeCategory) => void;
}

const RegionLabels = ({ selectedRegion, onRegionSelect }: RegionLabelsProps) => (
  <>
    {categoryRegions.map((region) => (
      <text
        key={region.id}
        x={region.x + region.w / 2}
        y={region.y - 18}
        textAnchor="middle"
        className={`font-heading select-none map-region${selectedRegion === region.id ? " map-region-active" : ""}`}
        role="button"
        tabIndex={0}
        focusable="true"
        style={{ fontSize: 17, letterSpacing: "0.35em", fontWeight: 600 }}
        onClick={(event) => {
          event.stopPropagation();
          onRegionSelect(region.id);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          onRegionSelect(region.id);
        }}
      >
        {region.label}
      </text>
    ))}
  </>
);

interface EdgesProps {
  edges: KnowledgeEdge[];
  nodeById: Map<string, KnowledgeNode>;
  relatedNodeIds: Set<string> | null;
}

const Edges = ({ edges, nodeById, relatedNodeIds }: EdgesProps) => (
  <>
    {edges.map((edge) => {
      const fromNode = nodeById.get(edge.from);
      const toNode = nodeById.get(edge.to);
      if (!fromNode || !toNode) return null;
      return (
        <line
          key={`${edge.from}-${edge.to}`}
          x1={fromNode.x}
          y1={fromNode.y}
          x2={toNode.x}
          y2={toNode.y}
          stroke="currentColor"
          strokeWidth={1}
          className="map-fade"
          style={{ opacity: edgeOpacity(edge, relatedNodeIds) }}
        />
      );
    })}
  </>
);

interface NodesProps {
  filteredNodes: KnowledgeNode[];
  hoveredId: string | null;
  selectedId: string | null;
  relatedNodeIds: Set<string> | null;
  selectedRegion: KnowledgeCategory | null;
  onHoveredId: (value: string | null) => void;
  onSelectedId: (value: string | null) => void;
}

const Nodes = ({
  filteredNodes,
  hoveredId,
  selectedId,
  relatedNodeIds,
  selectedRegion,
  onHoveredId,
  onSelectedId,
}: NodesProps) => {
  return (
    <>
      {filteredNodes.map((node) => (
        <KnowledgeMapNode
          key={node.id}
          node={node}
          hoveredId={hoveredId}
          selectedId={selectedId}
          relatedNodeIds={relatedNodeIds}
          selectedRegion={selectedRegion}
          onHoveredId={onHoveredId}
          onSelectedId={onSelectedId}
        />
      ))}
    </>
  );
};

interface KnowledgeMapNodeProps {
  node: KnowledgeNode;
  hoveredId: string | null;
  selectedId: string | null;
  relatedNodeIds: Set<string> | null;
  selectedRegion: KnowledgeCategory | null;
  onHoveredId: (value: string | null) => void;
  onSelectedId: (value: string | null) => void;
}

const KnowledgeMapNode = ({
  node,
  hoveredId,
  selectedId,
  relatedNodeIds,
  selectedRegion,
  onHoveredId,
  onSelectedId,
}: KnowledgeMapNodeProps) => {
  const active = hoveredId === node.id || selectedId === node.id;
  const handleSelect = () => onSelectedId(selectedId === node.id ? null : node.id);
  return (
    <g
      transform={`translate(${node.x},${node.y})`}
      className="map-node-group map-fade"
      role="button"
      tabIndex={0}
      focusable="true"
      style={{ opacity: nodeOpacity(node, relatedNodeIds, selectedRegion), cursor: "pointer" }}
      onPointerEnter={(event) => {
        if (event.pointerType !== "touch") onHoveredId(node.id);
      }}
      onPointerLeave={() => onHoveredId(null)}
      onFocus={() => onHoveredId(node.id)}
      onBlur={() => onHoveredId(null)}
      onClick={(event) => {
        event.stopPropagation();
        handleSelect();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        handleSelect();
      }}
    >
      <circle
        r={nodeRadius[node.status] + 14}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        className="map-focus-ring"
      />
      <g
        className={`map-node-visual${node.category === "project" ? " map-pop" : ""}`}
        style={{ transform: active ? "scale(1.2)" : undefined }}
      >
        <circle
          r={nodeRadius[node.status]}
          fill={node.category === "knowledge" ? "var(--card-bg)" : "currentColor"}
          stroke="currentColor"
          strokeWidth={node.category === "knowledge" ? 1.8 : 0}
        />
      </g>
      <circle r={24} fill="transparent" />
      <text
        x={0}
        y={nodeRadius[node.status] + 17}
        textAnchor="middle"
        className="font-heading select-none"
        style={{
          fontSize: fontSize[node.status],
          fontWeight: active ? 700 : 500,
          fill: "currentColor",
          opacity: active ? 1 : 0.72,
        }}
      >
        {node.label}
      </text>
      <text
        x={0}
        y={-nodeRadius[node.status] - 10}
        textAnchor="middle"
        className="font-heading select-none"
        style={{ fontSize: 10, letterSpacing: "0.08em", fill: "currentColor", opacity: 0.5 }}
      >
        {node.count}
      </text>
    </g>
  );
};

const SelectedRing = ({ selectedNode }: { selectedNode: KnowledgeNode | null }) => {
  if (!selectedNode) return null;
  return (
    <circle
      cx={selectedNode.x}
      cy={selectedNode.y}
      r={nodeRadius[selectedNode.status] + 18}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      opacity={0.35}
    />
  );
};
