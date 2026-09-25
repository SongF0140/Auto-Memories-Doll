import type Database from "better-sqlite3";
import { getDatabase } from "../storage/database";

/**
 * 实体扩展索引（对标 Hindsight link-expansion retrieval）
 *
 * 只读：实体表由 MemoryService 写入（entities / memory_entities / memory_relations），
 * 本类负责检索侧的批量扩展查询——给定种子记忆，返回与它共享实体或存在
 * caused_by 关系的邻居记忆，供 multi-hop 检索与 wikilink 邻居并集融合。
 *
 * 实体共现边不物化：查询时 JOIN 动态计算，与 wiki-graph 的
 * "wikilink 即关系"哲学互补——wikilink 管人写的关系，实体共现管机器算的关系。
 */
export class EntityIndex {
  private db: Database.Database;

  constructor() {
    this.db = getDatabase();
  }

  /**
   * 批量扩展：seedId → 邻居 id 列表（因果边邻居在前，实体共现邻居按共享数降序在后）。
   * 已排除种子自身与 status=superseded 卡片。表不存在时返回空 Map（实体层未启用）。
   */
  getExpandedNeighbors(seedIds: string[], limitPerSeed: number = 15): Map<string, string[]> {
    const result = new Map<string, string[]>();
    if (seedIds.length === 0) return result;

    for (const seedId of seedIds) {
      const neighbors = new Set<string>();
      for (const id of this.getRelationNeighbors(seedId)) neighbors.add(id);
      for (const row of this.getEntityNeighbors(seedId, limitPerSeed)) neighbors.add(row.memoryId);
      neighbors.delete(seedId);
      if (neighbors.size > 0) result.set(seedId, [...neighbors]);
    }
    return result;
  }

  /** 单种子的实体共现邻居（共享实体数降序） */
  private getEntityNeighbors(
    seedId: string,
    limit: number,
  ): { memoryId: string; sharedEntities: number }[] {
    try {
      return this.db
        .prepare(
          `SELECT me2.memoryId AS memoryId, COUNT(DISTINCT me1.entityId) AS sharedEntities
           FROM memory_entities me1
           JOIN memory_entities me2 ON me1.entityId = me2.entityId
           JOIN memories m ON m.id = me2.memoryId
           WHERE me1.memoryId = ? AND me2.memoryId != ?
             AND (m.status IS NULL OR m.status != 'superseded')
           GROUP BY me2.memoryId
           ORDER BY sharedEntities DESC
           LIMIT ?`,
        )
        .all(seedId, seedId, limit) as { memoryId: string; sharedEntities: number }[];
    } catch {
      // 实体表尚未创建（老库）→ 视为无扩展
      return [];
    }
  }

  /** 单种子的因果邻居（导致的后继 + 依赖的前因，双向） */
  private getRelationNeighbors(seedId: string): string[] {
    try {
      const rows = this.db
        .prepare(
          `SELECT DISTINCT r.toId AS neighborId FROM memory_relations r
           JOIN memories m ON m.id = r.toId
           WHERE r.relation = 'caused_by' AND r.fromId = ?
             AND (m.status IS NULL OR m.status != 'superseded')
           UNION
           SELECT DISTINCT r.fromId AS neighborId FROM memory_relations r
           JOIN memories m ON m.id = r.fromId
           WHERE r.relation = 'caused_by' AND r.toId = ?
             AND (m.status IS NULL OR m.status != 'superseded')`,
        )
        .all(seedId, seedId) as { neighborId: string }[];
      return rows.map((r) => r.neighborId);
    } catch {
      return [];
    }
  }
}
