import { afterEach, describe, expect, it } from "vitest";
import { createVectorSearchBackend, JsVectorSearchBackend } from "../lib/vector/backend";

describe("vector search backends", () => {
  const originalBackend = process.env.VECTOR_BACKEND;

  afterEach(() => {
    if (originalBackend === undefined) {
      delete process.env.VECTOR_BACKEND;
    } else {
      process.env.VECTOR_BACKEND = originalBackend;
    }
  });

  it("JS backend ranks rows by cosine similarity", () => {
    const backend = new JsVectorSearchBackend();

    const results = backend.search([1, 0], [
      { memoryId: "low", embedding: [0, 1] },
      { memoryId: "high", embedding: [1, 0] },
      { memoryId: "mid", embedding: [1, 1] },
    ], 2);

    expect(results).toEqual([
      { memoryId: "high", similarity: 1 },
      { memoryId: "mid", similarity: expect.closeTo(0.707, 3) },
    ]);
  });

  it("factory keeps search available when sqlite-vec is requested but extension is unavailable", () => {
    process.env.VECTOR_BACKEND = "sqlite-vec";

    const backend = createVectorSearchBackend();

    expect(backend.name).toBe("sqlite-vec-fallback");
    expect(backend.search([1], [{ memoryId: "m1", embedding: [1] }], 10)).toEqual([
      { memoryId: "m1", similarity: 1 },
    ]);
  });
});
