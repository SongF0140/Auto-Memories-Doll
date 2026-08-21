import { beforeEach, describe, expect, it, vi } from "vitest";
import { rankByKeywords, KeywordIndex } from "../lib/vector/keyword-index";

const { databaseMock, memoryRows } = vi.hoisted(() => ({
  memoryRows: [] as Record<string, unknown>[],
  databaseMock: {
    prepare: vi.fn(),
  },
}));

vi.mock("../lib/storage/database", () => ({
  getDatabase: () => databaseMock,
}));

beforeEach(() => {
  memoryRows.length = 0;
  databaseMock.prepare.mockReset();
  databaseMock.prepare.mockImplementation((sql: string) => {
    if (sql.includes("sqlite_master")) {
      return { get: () => ({ exists: 1 }) };
    }
    return { all: vi.fn(() => memoryRows) };
  });
});

describe("rankByKeywords", () => {
  it("does not include exact-match bonuses in the denominator when no bonus was awarded", () => {
    const result = rankByKeywords(
      "needle",
      [
        {
          id: "content-only",
          title: "Unrelated",
          content: "needle",
          summary: "",
          tags: [],
          topic: "",
          updatedAt: "2026-08-21T00:00:00.000Z",
        },
      ],
      1,
    )[0];

    expect(result.similarity).toBeCloseTo(0.3 + (1 / 19) * 0.7, 6);
  });

  it("treats a multi-word tag as an exact tag match", () => {
    const exact = rankByKeywords(
      "machine learning",
      [
        {
          id: "tagged",
          title: "Tagged",
          content: "",
          summary: "",
          tags: ["machine learning"],
          topic: "ai",
          updatedAt: "2026-08-21T00:00:00.000Z",
        },
      ],
      1,
    )[0].similarity;
    const splitOnly = rankByKeywords(
      "machine learning",
      [
        {
          id: "tagged",
          title: "Tagged",
          content: "",
          summary: "",
          tags: ["machine", "learning"],
          topic: "ai",
          updatedAt: "2026-08-21T00:00:00.000Z",
        },
      ],
      1,
    )[0].similarity;

    expect(exact).toBeGreaterThan(splitOnly);
  });
});

describe("KeywordIndex", () => {
  it("prefilters rows in SQL and caps the candidate set before ranking", () => {
    memoryRows.push({
      id: "m1",
      title: "Offline search",
      titleZh: null,
      content: "Embedding fallback",
      summary: "",
      summaryZh: null,
      tags: JSON.stringify(["fallback"]),
      tagsZh: null,
      topic: "ai",
      topicZh: null,
      updatedAt: "2026-08-21T00:00:00.000Z",
    });

    const index = new KeywordIndex();
    index.search("offline search", 5);

    const memoriesQuery = databaseMock.prepare.mock.calls
      .map(([sql]) => String(sql))
      .find((sql) => sql.includes("FROM memories"))!;
    expect(memoriesQuery).toContain("WHERE");
    expect(memoriesQuery).toContain("LIMIT ?");
  });
});
