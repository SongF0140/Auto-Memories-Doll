import { beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";

/**
 * 路由分布统计单测（健康度面板·路由分布项）。
 * 使用真实 in-memory SQLite 验证建表、按天聚合 upsert、窗口快照，
 * 以及 recordRouteStat 旁路打点的"失败静默"语义（统计不挡检索）。
 */

const { dbRef } = vi.hoisted(() => ({
  dbRef: { current: null as Database.Database | null },
}));

vi.mock("../lib/storage/database", () => ({
  getDatabase: () => dbRef.current,
  closeDatabase: () => undefined,
}));

import { RouteStatsService, recordRouteStat } from "../lib/vector/route-stats";

describe("RouteStatsService（路由分布统计）", () => {
  let service: RouteStatsService;

  beforeEach(() => {
    dbRef.current = new Database(":memory:");
    service = new RouteStatsService(dbRef.current);
  });

  it("同日同路由重复记录按 count 累加", () => {
    service.record("temporal", "2026-09-14");
    service.record("temporal", "2026-09-14");
    service.record("single-hop", "2026-09-14");

    const stats = service.getStats(7);
    expect(stats.totals).toEqual({ temporal: 2, "single-hop": 1 });
    expect(stats.total).toBe(3);
  });

  it("窗口快照只统计 since 之后的日期", () => {
    service.record("temporal", "2026-09-01");
    service.record("temporal", "2026-09-13");
    service.record("overview", "2026-09-14");

    const stats = service.getStats(3); // 近 3 天（含今天）
    expect(stats.since).toBe("2026-09-12");
    expect(stats.totals).toEqual({ temporal: 1, overview: 1 });
  });

  it("空表返回零总数", () => {
    const stats = service.getStats(7);
    expect(stats.totals).toEqual({});
    expect(stats.total).toBe(0);
  });
});

describe("recordRouteStat（检索热路径旁路打点）", () => {
  it("写入共享库且按天累加", () => {
    dbRef.current = new Database(":memory:");
    recordRouteStat("temporal");
    recordRouteStat("temporal");
    recordRouteStat("single-hop");

    const stats = new RouteStatsService(dbRef.current).getStats(7);
    expect(stats.totals).toEqual({ temporal: 2, "single-hop": 1 });
  });

  it("DB 异常时静默不抛（统计失败不影响检索主流程）", async () => {
    dbRef.current = new Database(":memory:");
    dbRef.current.close(); // 已关闭的连接：建表/写入都会抛错

    vi.resetModules(); // 重建模块级单例，让它命中坏连接
    const mod = await import("../lib/vector/route-stats");
    expect(() => mod.recordRouteStat("temporal")).not.toThrow();
  });
});
