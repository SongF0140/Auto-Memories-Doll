import { describe, it, expect } from "vitest";
import {
  hitAtK,
  reciprocalRank,
  recallAtK,
  mrr,
  computeMetrics,
  groupMetrics,
} from "../eval/metrics";

describe("检索评测指标", () => {
  const hits = [
    { query: "q1", ranked: ["a", "b", "c"], expected: "a" },
    { query: "q2", ranked: ["b", "a", "c"], expected: "a" },
    { query: "q3", ranked: ["b", "c", "d"], expected: "a" },
  ];

  it("hitAtK 按截断判断命中", () => {
    expect(hitAtK(hits[0], 1)).toBe(true);
    expect(hitAtK(hits[1], 1)).toBe(false);
    expect(hitAtK(hits[1], 2)).toBe(true);
    expect(hitAtK(hits[2], 3)).toBe(false);
  });

  it("reciprocalRank 命中位置的倒数，未命中为 0", () => {
    expect(reciprocalRank(hits[0])).toBe(1);
    expect(reciprocalRank(hits[1])).toBe(0.5);
    expect(reciprocalRank(hits[2])).toBe(0);
  });

  it("recallAtK 计算命中率", () => {
    expect(recallAtK(hits, 1)).toBeCloseTo(1 / 3);
    expect(recallAtK(hits, 2)).toBeCloseTo(2 / 3);
    expect(recallAtK(hits, 10)).toBeCloseTo(2 / 3);
  });

  it("mrr 为倒数排名均值", () => {
    expect(mrr(hits)).toBeCloseTo((1 + 0.5 + 0) / 3);
  });

  it("空输入返回 0 而不是 NaN", () => {
    expect(recallAtK([], 5)).toBe(0);
    expect(mrr([])).toBe(0);
    expect(computeMetrics([]).total).toBe(0);
  });

  it("computeMetrics 汇总四项指标", () => {
    const metrics = computeMetrics(hits);
    expect(metrics).toEqual({
      total: 3,
      recallAt1: 0.3333,
      recallAt5: 0.6667,
      recallAt10: 0.6667,
      mrr: 0.5,
    });
  });

  it("groupMetrics 按分组分别统计", () => {
    const grouped = groupMetrics([
      { ...hits[0], group: "title" },
      { ...hits[2], group: "colloquial" },
    ]);
    expect(grouped.title.recallAt1).toBe(1);
    expect(grouped.colloquial.recallAt1).toBe(0);
  });
});
