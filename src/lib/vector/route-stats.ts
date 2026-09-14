import Database from "better-sqlite3";
import { getDatabase } from "../storage/database";
import { QueryRoute } from "./query-classifier";

/**
 * 检索路由分布统计（指南 §六健康度面板：路由分布项）。
 *
 * 记录每次检索的分类器决策（single-hop / multi-hop / overview / temporal），
 * 按天聚合落库——观测各路由的实际占比，为路由规则调优和分组召回质量评估提供数据。
 *
 * 定位是"旁路观测"：任何统计失败都不允许影响检索主流程（调用方 try/catch 吞掉）。
 */

export type RouteStatsSnapshot = {
  /** 统计窗口起始日期（yyyy-mm-dd，含当天） */
  since: string;
  /** 窗口期内各路由的命中次数 */
  totals: Record<string, number>;
  /** 窗口期内检索总次数 */
  total: number;
};

export class RouteStatsService {
  private db: Database.Database;

  constructor(db: Database.Database = getDatabase()) {
    this.db = db;
    this.init();
  }

  /** 记录一次路由决策（按天聚合，幂等 upsert） */
  record(route: string, date: string = new Date().toISOString().slice(0, 10)): void {
    this.db
      .prepare(
        `INSERT INTO route_stats (date, route, count) VALUES (?, ?, 1)
         ON CONFLICT(date, route) DO UPDATE SET count = count + 1`,
      )
      .run(date, route);
  }

  /** 近 N 天的路由分布快照（含今天） */
  getStats(days: number = 7): RouteStatsSnapshot {
    const since = new Date(Date.now() - (Math.max(1, days) - 1) * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const rows = this.db
      .prepare(
        `SELECT route, SUM(count) as count FROM route_stats
         WHERE date >= ? GROUP BY route ORDER BY count DESC`,
      )
      .all(since) as Array<{ route: string; count: number }>;

    const totals: Record<string, number> = {};
    let total = 0;
    for (const row of rows) {
      totals[row.route] = row.count;
      total += row.count;
    }
    return { since, totals, total };
  }

  close(): void {
    // shared connection — closed by closeDatabase()
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS route_stats (
        date TEXT NOT NULL,
        route TEXT NOT NULL,
        count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (date, route)
      );
    `);
  }
}

/** 模块级单例：检索热路径上避免重复建表检查；失败静默（统计不挡检索） */
let sharedStats: RouteStatsService | null = null;

export function recordRouteStat(route: QueryRoute): void {
  try {
    sharedStats ??= new RouteStatsService();
    sharedStats.record(route);
  } catch {
    // 统计是旁路：DB 异常（如测试 mock、库未初始化）时静默跳过
  }
}
