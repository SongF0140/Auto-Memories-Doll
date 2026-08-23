import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rewriteQueryVariants: vi.fn(),
}));

vi.mock("../lib/vector/query-rewriter", () => ({
  rewriteQueryVariants: mocks.rewriteQueryVariants,
}));

import { searchWithExpansion } from "../lib/vector/query-expansion";

function makeRetriever(resultsByQuery: Record<string, { memoryId: string; similarity: number }[]>) {
  const search = vi.fn(async (query: string) => resultsByQuery[query] ?? []);
  return { search };
}

describe("searchWithExpansion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rewriteQueryVariants.mockResolvedValue([]);
  });

  it("无改写变体时退化为单路召回", async () => {
    const retriever = makeRetriever({
      原句查询: [{ memoryId: "m1", similarity: 0.9 }],
    });

    const results = await searchWithExpansion(retriever, "原句查询", 10);

    expect(mocks.rewriteQueryVariants).toHaveBeenCalledWith("原句查询");
    expect(retriever.search).toHaveBeenCalledTimes(1);
    expect(results).toEqual([{ memoryId: "m1", similarity: 0.9 }]);
  });

  it("多变体多路召回，同一记忆取最高相似度并降序排列", async () => {
    mocks.rewriteQueryVariants.mockResolvedValue(["变体A", "变体B"]);
    const retriever = makeRetriever({
      查询: [
        { memoryId: "m1", similarity: 0.5 },
        { memoryId: "m2", similarity: 0.8 },
      ],
      变体A: [
        { memoryId: "m1", similarity: 0.95 },
        { memoryId: "m3", similarity: 0.6 },
      ],
      变体B: [{ memoryId: "m2", similarity: 0.7 }],
    });

    const results = await searchWithExpansion(retriever, "查询", 10);

    expect(retriever.search).toHaveBeenCalledTimes(3);
    expect(results).toEqual([
      { memoryId: "m1", similarity: 0.95 },
      { memoryId: "m2", similarity: 0.8 },
      { memoryId: "m3", similarity: 0.6 },
    ]);
  });

  it("合并结果超过 limit 时截断", async () => {
    mocks.rewriteQueryVariants.mockResolvedValue(["变体A"]);
    const retriever = makeRetriever({
      查询: [{ memoryId: "m1", similarity: 0.9 }],
      变体A: [
        { memoryId: "m2", similarity: 0.8 },
        { memoryId: "m3", similarity: 0.7 },
      ],
    });

    const results = await searchWithExpansion(retriever, "查询", 2);

    expect(results).toHaveLength(2);
    expect(results.map((r) => r.memoryId)).toEqual(["m1", "m2"]);
  });

  it("expansionEnabled=false 时跳过改写器", async () => {
    const retriever = makeRetriever({
      查询: [{ memoryId: "m1", similarity: 0.9 }],
    });

    const results = await searchWithExpansion(retriever, "查询", 10, {
      expansionEnabled: false,
    });

    expect(mocks.rewriteQueryVariants).not.toHaveBeenCalled();
    expect(results).toEqual([{ memoryId: "m1", similarity: 0.9 }]);
  });

  it("minSimilarity 透传给每一路召回", async () => {
    mocks.rewriteQueryVariants.mockResolvedValue(["变体A"]);
    const retriever = makeRetriever({});

    await searchWithExpansion(retriever, "查询", 10, { minSimilarity: 0.4 });

    expect(retriever.search).toHaveBeenCalledWith("查询", 10, 0.4);
    expect(retriever.search).toHaveBeenCalledWith("变体A", 10, 0.4);
  });
});
