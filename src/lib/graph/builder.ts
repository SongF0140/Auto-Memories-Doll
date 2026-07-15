import { GraphEdge } from "../../types/memory";
import { getCurrentTime } from "../utils/date";

export const buildGraphEdge = (
  from: string,
  to: string,
  relation: string,
  weight: number = 1
): GraphEdge => {
  return {
    from,
    to,
    relation,
    weight,
    updatedAt: getCurrentTime(),
  };
};

export const calculateRelationWeight = (
  frequency: number,
  recencyScore: number
): number => {
  return frequency * 0.5 + recencyScore * 0.5;
};

export const extractRelations = (
  content: string,
  memoryId: string,
  existingMemoryIds: string[]
): GraphEdge[] => {
  const edges: GraphEdge[] = [];
  
  existingMemoryIds.forEach(otherId => {
    if (otherId === memoryId) return;
    
    if (content.includes(otherId)) {
      edges.push(buildGraphEdge(memoryId, otherId, "mentions", 0.8));
    }
  });

  return edges;
};