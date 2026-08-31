import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import type { MemoryRecord } from "@/types/memory";
import {
  buildKnowledgeGraph,
  collectRelatedNodeIds,
  countNodesByCategory,
  filterKnowledgeNodes,
  clampZoom,
  type KnowledgeCategory,
  type KnowledgeNode,
  type ViewState,
} from "./knowledge-map-data";

export interface KnowledgeMapState {
  nodes: KnowledgeNode[];
  edges: ReturnType<typeof buildKnowledgeGraph>["edges"];
  filteredNodes: KnowledgeNode[];
  categoryCounts: ReturnType<typeof countNodesByCategory>;
  selectedNode: KnowledgeNode | null;
  relatedNodeIds: Set<string> | null;
  view: ViewState;
  hoveredId: string | null;
  selectedId: string | null;
  finderOpen: boolean;
  query: string;
  activeCategory: KnowledgeCategory | null;
  selectedCount: number;
  finderActive: boolean;
  setQuery: (value: string) => void;
  setHoveredId: (value: string | null) => void;
  setSelectedId: (value: string | null) => void;
  toggleFinder: () => void;
  toggleCategory: (category: KnowledgeCategory) => void;
  clearFilters: () => void;
  resetSelection: () => void;
  setFinderOpen: (value: boolean) => void;
  setActiveCategory: (value: KnowledgeCategory | null) => void;
  setView: Dispatch<SetStateAction<ViewState>>;
  zoomBy: (factor: number) => void;
  resetView: () => void;
}

export const useKnowledgeMapState = (memories: MemoryRecord[]): KnowledgeMapState => {
  const { nodes, edges } = useMemo(() => buildKnowledgeGraph(memories), [memories]);
  const [view, setView] = useState<ViewState>({ x: 0, y: 0, k: 1 });
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [finderOpen, setFinderOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<KnowledgeCategory | null>(null);

  const filteredNodes = useMemo(() => filterKnowledgeNodes(nodes, query, activeCategory), [nodes, query, activeCategory]);
  const categoryCounts = useMemo(() => countNodesByCategory(nodes), [nodes]);
  const selectedNode = useMemo(() => nodes.find((node) => node.id === selectedId) ?? null, [nodes, selectedId]);
  const relatedNodeIds = useMemo(() => {
    const focusId = selectedId ?? hoveredId;
    return focusId ? collectRelatedNodeIds(nodes, edges, focusId) : null;
  }, [edges, hoveredId, nodes, selectedId]);

  const toggleFinder = useCallback(() => setFinderOpen((open) => !open), []);
  const toggleCategory = useCallback(
    (category: KnowledgeCategory) => {
      setActiveCategory((current) => (current === category ? null : category));
    },
    [],
  );
  const clearFilters = useCallback(() => {
    setQuery("");
    setActiveCategory(null);
  }, []);
  const resetSelection = useCallback(() => {
    setSelectedId(null);
    setHoveredId(null);
  }, []);
  const zoomBy = useCallback((factor: number) => {
    setView((current) => {
      const nextK = clampZoom(current.k * factor);
      return { ...current, k: nextK };
    });
  }, []);
  const resetView = useCallback(() => setView({ x: 0, y: 0, k: 1 }), []);

  return {
    nodes,
    edges,
    filteredNodes,
    categoryCounts,
    selectedNode,
    relatedNodeIds,
    view,
    hoveredId,
    selectedId,
    finderOpen,
    query,
    activeCategory,
    selectedCount: Number(Boolean(query.trim())) + Number(Boolean(activeCategory)),
    finderActive: Boolean(query.trim()) || Boolean(activeCategory),
    setQuery,
    setHoveredId,
    setSelectedId,
    toggleFinder,
    toggleCategory,
    clearFilters,
    resetSelection,
    setFinderOpen,
    setActiveCategory,
    setView,
    zoomBy,
    resetView,
  };
};
