import { GraphEdge } from "../../types/memory";
import { getDatabase } from "../storage/database";
import Database from "better-sqlite3";

export class GraphManager {
  private db: Database.Database;

  constructor() {
    this.db = getDatabase();
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS graph_edges (
        fromId TEXT,
        toId TEXT,
        relation TEXT,
        weight REAL,
        updatedAt TEXT,
        PRIMARY KEY (fromId, toId, relation)
      )
    `);
  }

  create(edge: GraphEdge): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO graph_edges (fromId, toId, relation, weight, updatedAt)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(edge.from, edge.to, edge.relation, edge.weight, edge.updatedAt);
  }

  read(from: string, to: string): GraphEdge | null {
    const stmt = this.db.prepare("SELECT * FROM graph_edges WHERE fromId = ? AND toId = ?");
    const row = stmt.get(from, to) as any;
    if (!row) return null;

    return {
      from: row.fromId,
      to: row.toId,
      relation: row.relation,
      weight: row.weight,
      updatedAt: row.updatedAt,
    };
  }

  update(edge: GraphEdge): void {
    this.create(edge);
  }

  delete(from: string, to: string): void {
    const stmt = this.db.prepare("DELETE FROM graph_edges WHERE fromId = ? AND toId = ?");
    stmt.run(from, to);
  }

  getNeighbors(nodeId: string): GraphEdge[] {
    const stmt = this.db.prepare("SELECT * FROM graph_edges WHERE fromId = ? OR toId = ?");
    const rows = stmt.all(nodeId, nodeId) as any[];

    return rows.map((row) => ({
      from: row.fromId,
      to: row.toId,
      relation: row.relation,
      weight: row.weight,
      updatedAt: row.updatedAt,
    }));
  }

  list(): GraphEdge[] {
    const stmt = this.db.prepare("SELECT * FROM graph_edges");
    const rows = stmt.all() as any[];

    return rows.map((row) => ({
      from: row.fromId,
      to: row.toId,
      relation: row.relation,
      weight: row.weight,
      updatedAt: row.updatedAt,
    }));
  }

  getRelations(memoryId: string): { to: string; relation: string; weight: number }[] {
    const stmt = this.db.prepare("SELECT * FROM graph_edges WHERE fromId = ?");
    const rows = stmt.all(memoryId) as any[];

    return rows.map((row) => ({
      to: row.toId,
      relation: row.relation,
      weight: row.weight,
    }));
  }

  close(): void {
    // shared connection — no-op
  }
}
