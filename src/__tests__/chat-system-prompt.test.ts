import { describe, expect, it } from "vitest";
import { assembleSystemMessage, buildIntentBlock } from "../features/chat/system-prompt";

describe("chat system prompt helpers", () => {
  it("builds an empty intent block for ordinary chat", () => {
    const block = buildIntentBlock({
      type: "chat",
      confidence: 0.3,
      entities: {},
      matchedKeywords: [],
    });

    expect(block).toBe("");
  });

  it("includes intent, alternatives, and extracted entity details", () => {
    const block = buildIntentBlock(
      {
        type: "memory_create",
        confidence: 0.91,
        entities: {},
        matchedKeywords: ["remember"],
        alternatives: [{ type: "memory_query", confidence: 0.42, matchedKeywords: [] }],
      },
      {
        title: "New memory",
        content: "A long memory body",
        tags: ["tag-a"],
        topic: "notes",
      },
    );

    expect(block).toContain("memory_create");
    expect(block).toContain("91%");
    expect(block).toContain("memory_query");
    expect(block).toContain("New memory");
    expect(block).toContain("tag-a");
    expect(block).toContain("notes");
  });

  it("assembles system prefix, intent block, and memory block", () => {
    const message = assembleSystemMessage({
      systemPrefix: "SYS",
      intentBlock: "INTENT",
      memoryBlock: "MEMORY",
    });

    expect(message).toContain("SYS");
    expect(message).toContain("INTENT");
    expect(message).toContain("MEMORY");
  });
});
