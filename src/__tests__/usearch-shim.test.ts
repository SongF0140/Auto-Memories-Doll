import { describe, expect, it } from "vitest";
import { createShimUsearchModule } from "../lib/vector/usearch-shim";

describe("usearch shim", () => {
  it("respects expansion_search instead of scanning every vector", () => {
    const { Index } = createShimUsearchModule();
    const index = new Index({
      dimensions: 2,
      connectivity: 1,
      expansion_add: 1,
      expansion_search: 1,
    });

    index.add(BigInt(1), new Float32Array([1, 0]));
    index.add(BigInt(2), new Float32Array([0.9, 0.1]));
    index.add(BigInt(3), new Float32Array([0, 1]));
    index.add(BigInt(4), new Float32Array([0.1, 0.9]));

    const result = index.search(new Float32Array([0, 1]), 1);

    expect(result.keys[0]).toBe(BigInt(1));
  });
});
