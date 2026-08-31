import { beforeEach, describe, expect, it, vi } from "vitest";

const { embeddingMock } = vi.hoisted(() => ({
  embeddingMock: vi.fn(),
}));

vi.mock("../lib/ai/model-adapter", () => ({
  ModelAdapter: {
    generateEmbedding: embeddingMock,
  },
}));

import { buildVectorRecord } from "../lib/vector/generator";

describe("buildVectorRecord", () => {
  beforeEach(() => {
    embeddingMock.mockReset();
  });

  it("uses the actual embedding length as dimensions", async () => {
    embeddingMock.mockResolvedValue({
      embedding: [0.1, 0.2, 0.3],
      model: "embedding-3",
      timestamp: "2026-01-01T00:00:00Z",
    });

    const record = await buildVectorRecord("m1", "content");

    expect(record.dimensions).toBe(3);
  });
});
