import { describe, it, expect } from "vitest";
import { classifyQuery, QueryRoute } from "../lib/vector/query-classifier";
import { reciprocalRankFusion } from "../lib/vector/fusion";

describe("classifyQuery（I-8 自适应检索路由）", () => {
  it("对比/关系类查询路由到 multi-hop", () => {
    const queries = [
      "A 和 B 的区别",
      "两个方案对比哪个更好",
      "React 为什么会这样",
      "两者的演进关系",
    ];
    queries.forEach((query) => {
      expect(classifyQuery(query, ["react"])).toBe<QueryRoute>("multi-hop");
    });
  });

  it("总览类 + 话题命中路由到 overview", () => {
    expect(classifyQuery("总结一下 ai-coding 的要点", ["ai-coding"])).toBe("overview");
    expect(classifyQuery("梳理一下 ai-coding 的全部内容", ["ai-coding"])).toBe("overview");
  });

  it("总览类但无话题命中时不跳过向量检索", () => {
    expect(classifyQuery("总结一下", ["react"])).toBe("single-hop");
  });

  it("调用方没有话题上下文时总览词单独生效", () => {
    expect(classifyQuery("帮我盘点所有记忆")).toBe("overview");
  });

  it("普通事实查询默认 single-hop", () => {
    expect(classifyQuery("useEffect 的用法", ["react"])).toBe("single-hop");
    expect(classifyQuery("")).toBe("single-hop");
  });
});

describe("reciprocalRankFusion（I-8 RRF 三路融合）", () => {
  it("多列排名靠前者胜出，单列首位命中归一化为 1", () => {
    const fused = reciprocalRankFusion([
      [
        { memoryId: "a", similarity: 0.9 },
        { memoryId: "b", similarity: 0.7 },
      ],
      [{ memoryId: "a", similarity: 0.8 }],
    ]);
    expect(fused[0]).toEqual({ memoryId: "a", similarity: 1 });
    expect(fused[0].similarity).toBeGreaterThan(fused[1].similarity);
  });

  it("RRF 只依赖排名，不依赖各路绝对分值量纲", () => {
    const fused = reciprocalRankFusion([
      [{ memoryId: "a", similarity: 0.01 }],
      [{ memoryId: "b", similarity: 0.99 }],
    ]);
    // 两列各排第一 → 并列
    expect(fused[0].similarity).toBeCloseTo(fused[1].similarity, 10);
  });

  it("k=60 时的分数符合 1/(k+rank) 公式", () => {
    const fused = reciprocalRankFusion([[{ memoryId: "a", similarity: 0.9 }]]);
    expect(fused[0].similarity).toBeCloseTo(1, 10); // 单列首位 → 归一化为 1

    const fusedTwo = reciprocalRankFusion([
      [{ memoryId: "a", similarity: 0.9 }],
      [
        { memoryId: "a", similarity: 0.5 },
        { memoryId: "b", similarity: 0.4 },
      ],
    ]);
    // a: 1/61 + 1/61 = 2/61；b: 1/62；max = 2/61
    expect(fusedTwo[0].similarity).toBeCloseTo(1, 10);
    expect(fusedTwo[1].similarity).toBeCloseTo(1 / 62 / (2 / 61), 10);
  });

  it("空输入与空列安全", () => {
    expect(reciprocalRankFusion([])).toEqual([]);
    expect(reciprocalRankFusion([[]])).toEqual([]);
  });
});
