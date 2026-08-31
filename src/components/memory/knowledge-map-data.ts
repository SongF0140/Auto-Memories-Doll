import type { MemoryRecord } from "@/types/memory";

export const VIEW_W = 1400;
export const VIEW_H = 900;
export const MIN_ZOOM = 0.4;
export const MAX_ZOOM = 6;

export type KnowledgeCategory = "knowledge" | "work" | "project";
export type KnowledgeStatus = "active" | "normal" | "small";

export interface ViewState {
  x: number;
  y: number;
  k: number;
}

export interface KnowledgeNode {
  id: string;
  label: string;
  x: number;
  y: number;
  category: KnowledgeCategory;
  count: number;
  keywords: string[];
  memoryIds: string[];
  status: KnowledgeStatus;
}

export interface KnowledgeEdge {
  from: string;
  to: string;
  strength?: number;
}

export interface CategoryRegion {
  id: KnowledgeCategory;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
}

export interface KnowledgeGraph {
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
}

export const categoryRegions: CategoryRegion[] = [
  { id: "knowledge", label: "知识归纳", x: 100, y: 80, w: 480, h: 360, color: "rgba(166, 124, 0, 0.08)" },
  { id: "work", label: "工作经验", x: 620, y: 80, w: 480, h: 360, color: "rgba(201, 162, 39, 0.08)" },
  { id: "project", label: "项目沉淀", x: 360, y: 480, w: 480, h: 340, color: "rgba(160, 120, 60, 0.08)" },
];

const categoryNodeInsets: Record<KnowledgeCategory, { x: number; y: number }> = {
  knowledge: { x: 260, y: 120 },
  work: { x: 150, y: 110 },
  project: { x: 170, y: 110 },
};

const normalizeText = (values: Array<string | undefined>) =>
  values.filter((value): value is string => Boolean(value)).join(" ").toLowerCase();

const topicKey = (memory: MemoryRecord) => memory.topic?.trim() || "general";

const topicLabel = (topic: string) => {
  const chars = Array.from(topic);
  return `${(chars[0] ?? "").toUpperCase()}${chars.slice(1).join("")}`;
};

export const inferCategory = (memory: MemoryRecord): KnowledgeCategory => {
  const haystack = normalizeText([memory.topic, memory.title, memory.summary, ...(memory.tags ?? [])]);
  if (/(project|planning|roadmap|architecture|release|milestone|需求|规划|架构|项目)/.test(haystack)) return "project";
  if (/(work|job|meeting|review|bug|deploy|issue|workflow|任务|工作|会议|复盘|协作)/.test(haystack)) return "work";
  return "knowledge";
};

const bucketFor = (memory: MemoryRecord) => ({
  memories: [memory],
  keywords: new Set<string>(memory.tags ?? []),
  category: inferCategory(memory),
});

const statusFor = (count: number): KnowledgeStatus => {
  if (count > 5) return "active";
  if (count > 2) return "normal";
  return "small";
};

const regionFor = (category: KnowledgeCategory) =>
  categoryRegions.find((region) => region.id === category) ?? categoryRegions[0];

const positionFor = (category: KnowledgeCategory, index: number) => {
  const region = regionFor(category);
  const inset = categoryNodeInsets[category];
  const spreadX = Math.max(1, region.w - inset.x - 64);
  const spreadY = Math.max(1, region.h - inset.y - 64);
  return {
    x: region.x + inset.x + ((index * 137) % spreadX),
    y: region.y + inset.y + ((index * 97) % spreadY),
  };
};

const nodeLabel = (name: string) => topicLabel(name);

const buildBuckets = (memories: MemoryRecord[]) => {
  const buckets = new Map<string, ReturnType<typeof bucketFor>>();
  memories.forEach((memory) => {
    const key = topicKey(memory);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.memories.push(memory);
      memory.tags?.forEach((tag) => bucket.keywords.add(tag));
      return;
    }
    buckets.set(key, bucketFor(memory));
  });
  return buckets;
};

const buildNodes = (buckets: Map<string, ReturnType<typeof bucketFor>>) =>
  Array.from(buckets.entries()).map(([name, data], index) => {
    const position = positionFor(data.category, index);
    const count = data.memories.length;
    return {
      id: name,
      label: nodeLabel(name),
      x: position.x,
      y: position.y,
      category: data.category,
      count,
      keywords: Array.from(data.keywords).slice(0, 6),
      memoryIds: data.memories.map((memory) => memory.id),
      status: statusFor(count),
    };
  });

const buildEdges = (nodes: KnowledgeNode[]) => {
  const edges: KnowledgeEdge[] = [];
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const common = nodes[i].keywords.filter((keyword) => nodes[j].keywords.includes(keyword));
      if (common.length > 0) edges.push({ from: nodes[i].id, to: nodes[j].id, strength: common.length });
    }
  }
  return edges;
};

export const buildKnowledgeGraph = (memories: MemoryRecord[]): KnowledgeGraph => {
  const buckets = buildBuckets(memories);
  const nodes = buildNodes(buckets);
  return { nodes, edges: buildEdges(nodes) };
};

export const clampZoom = (value: number) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value));

export const filterKnowledgeNodes = (
  nodes: KnowledgeNode[],
  query: string,
  activeCategory: KnowledgeCategory | null,
) => {
  const needle = query.trim().toLowerCase();
  if (!needle && !activeCategory) return nodes;
  return nodes.filter((node) => {
    const matchQuery =
      !needle ||
      node.label.toLowerCase().includes(needle) ||
      node.keywords.some((keyword) => keyword.toLowerCase().includes(needle));
    const matchCategory = !activeCategory || node.category === activeCategory;
    return matchQuery && matchCategory;
  });
};

export const countNodesByCategory = (nodes: KnowledgeNode[]) =>
  categoryRegions.map((region) => ({
    ...region,
    count: nodes.filter((node) => node.category === region.id).length,
  }));

export const collectRelatedNodeIds = (nodes: KnowledgeNode[], edges: KnowledgeEdge[], focusId: string) => {
  const related = new Set<string>([focusId]);
  const queue = [focusId];
  const visited = new Set<string>([focusId]);
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    edges.forEach((edge) => {
      const next = edge.from === current ? edge.to : edge.to === current ? edge.from : null;
      if (!next || visited.has(next) || !nodes.some((node) => node.id === next)) return;
      related.add(next);
      visited.add(next);
      queue.push(next);
    });
  }
  return related;
};

export const nodeRadius: Record<KnowledgeStatus, number> = {
  active: 28,
  normal: 22,
  small: 16,
};

export const fontSize: Record<KnowledgeStatus, number> = {
  active: 13,
  normal: 11,
  small: 10,
};
