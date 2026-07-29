import { GraphManager } from "./manager";
import { GraphEdge } from "../../types/memory";

export class GraphQuery {
  private manager: GraphManager;

  constructor() {
    this.manager = new GraphManager();
  }

  findRelatedMemories(
    memoryId: string,
    limit: number = 5,
  ): { memoryId: string; relation: string; weight: number }[] {
    const edges = this.manager.getNeighbors(memoryId);

    return edges
      .map((edge) => ({
        memoryId: edge.from === memoryId ? edge.to : edge.from,
        relation: edge.relation,
        weight: edge.weight,
      }))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, limit);
  }

  findPath(startId: string, endId: string, maxDepth: number = 3): GraphEdge[][] {
    const paths: GraphEdge[][] = [];
    const visited = new Set<string>();

    const dfs = (currentId: string, path: GraphEdge[]) => {
      if (currentId === endId) {
        paths.push([...path]);
        return;
      }

      if (path.length >= maxDepth) return;
      if (visited.has(currentId)) return;

      visited.add(currentId);
      const neighbors = this.manager.getNeighbors(currentId);

      neighbors.forEach((edge) => {
        const nextId = edge.from === currentId ? edge.to : edge.from;
        if (!visited.has(nextId)) {
          path.push(edge);
          dfs(nextId, path);
          path.pop();
        }
      });

      visited.delete(currentId);
    };

    dfs(startId, []);
    return paths;
  }

  getMemoryRelations(memoryId: string): GraphEdge[] {
    return this.manager.getNeighbors(memoryId);
  }

  close(): void {
    this.manager.close();
  }
}
